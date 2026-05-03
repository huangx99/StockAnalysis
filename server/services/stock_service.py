import asyncio
import json
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import HTTPException

from adapters.akshare_adapter import (
    AKShareAdapterError,
    ColumnValidationError,
    fetch_all_stocks,
    fetch_stock_hist,
    fetch_stock_info,
    fetch_stock_news,
    fetch_financial_report,
    fetch_dividend_data,
)
from cache.cache_manager import (
    search_cache,
    profile_cache,
    kline_cache,
    financials_cache,
    news_cache,
    spot_cache,
)
import math

from models.stock import (
    StockSearchResult,
    StockProfile,
    KLineData,
    FinancialStatement,
    DividendRecord,
    MarketStats,
    TechnicalIndicators,
    StockStats,
)
from models.document import StockDocument
from services import data_store

logger = logging.getLogger(__name__)

_SPOT_CACHE_KEY = "all_stocks"
_spot_lock = asyncio.Lock()

# Stock list file: persisted code+name mapping for search (never expires, refreshed on prewarm)
_STOCK_LIST_FILE = Path(__file__).parent.parent / "data" / "stock_list.json"


def _detect_market(code: str) -> str:
    if code.startswith("6"):
        return "SH"
    if code.startswith(("0", "3")):
        return "SZ"
    if code.startswith(("4", "8")):
        return "BJ"
    return "SZ"


async def prewarm_spot_cache():
    """Pre-fetch all stocks at startup: save stock list to file + populate spot cache."""
    logger.info("[prewarm] loading spot data in background...")
    df = await _get_spot_df()

    # Save stock list (code + name) to file for fast search
    try:
        _STOCK_LIST_FILE.parent.mkdir(parents=True, exist_ok=True)
        records = []
        for _, row in df.iterrows():
            records.append({
                "code": str(row["代码"]),
                "name": str(row["名称"]),
            })
        with open(_STOCK_LIST_FILE, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False)
        logger.info("[prewarm] saved %d stocks to %s", len(records), _STOCK_LIST_FILE)
    except Exception as e:
        logger.warning("[prewarm] failed to save stock list: %s", e)

    logger.info("[prewarm] spot cache ready")


def _load_stock_list_from_file() -> list[dict] | None:
    """Load stock list from local JSON file. Returns None if not available."""
    try:
        if _STOCK_LIST_FILE.exists():
            with open(_STOCK_LIST_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        logger.warning("Failed to load stock list file: %s", e)
    return None


async def _get_spot_df():
    """Get the full spot DataFrame, cached at the spot level (5 min TTL)."""
    if _SPOT_CACHE_KEY in spot_cache:
        logger.debug("[spot] cache HIT")
        return spot_cache[_SPOT_CACHE_KEY]
    async with _spot_lock:
        if _SPOT_CACHE_KEY in spot_cache:
            logger.debug("[spot] cache HIT (after lock)")
            return spot_cache[_SPOT_CACHE_KEY]
        logger.info("[spot] cache MISS — fetching all stocks from AKShare...")
        t0 = time.time()
        df = await asyncio.to_thread(fetch_all_stocks)
        elapsed = time.time() - t0
        logger.info("[spot] fetched %d stocks in %.2fs", len(df), elapsed)
        spot_cache[_SPOT_CACHE_KEY] = df
        return df


async def search_stocks(query: str) -> list[StockSearchResult]:
    """Search stocks by code or name. Uses local file for instant results."""
    q = query.strip().lower()
    if not q:
        return []

    cache_key = f"search:{q}"
    if cache_key in search_cache:
        logger.info("[search:%s] cache HIT → %d results", q, len(search_cache[cache_key]))
        return search_cache[cache_key]

    logger.info("[search:%s] searching...", q)
    t0 = time.time()

    # Try local file first (instant), fall back to spot cache (slow)
    stock_list = _load_stock_list_from_file()
    if stock_list is not None:
        results = []
        for item in stock_list:
            code = item["code"]
            name = item["name"]
            if q in code.lower() or q in name.lower():
                results.append(StockSearchResult(
                    symbol=code,
                    name=name,
                    market=_detect_market(code),
                    pinyin="",
                ))
                if len(results) >= 20:
                    break
        elapsed = time.time() - t0
        logger.info("[search:%s] %d results in %.3fs (from file)", q, len(results), elapsed)
        search_cache[cache_key] = results
        return results

    # Fallback: fetch from AKShare (first run, no file yet)
    logger.info("[search:%s] no stock list file, fetching from AKShare...", q)
    try:
        df = await _get_spot_df()
    except (AKShareAdapterError, ColumnValidationError) as e:
        logger.error("[search:%s] data source error: %s", q, e)
        raise HTTPException(status_code=502, detail=f"Data source error: {e}")

    mask = df["代码"].str.contains(q, na=False) | df["名称"].str.contains(q, na=False)
    filtered = df[mask].head(20)

    results = []
    for _, row in filtered.iterrows():
        code = str(row["代码"])
        results.append(StockSearchResult(
            symbol=code,
            name=str(row["名称"]),
            market=_detect_market(code),
            pinyin="",
        ))

    elapsed = time.time() - t0
    logger.info("[search:%s] %d results in %.2fs (from AKShare)", q, len(results), elapsed)
    search_cache[cache_key] = results
    return results


async def get_stock_profile(symbol: str) -> StockProfile:
    cache_key = f"profile:{symbol}"
    if cache_key in profile_cache:
        logger.info("[profile:%s] cache HIT", symbol)
        return profile_cache[cache_key]

    # Try local data store first
    local = data_store.load_stock_data(symbol, "profile")
    if local is not None:
        logger.info("[profile:%s] local HIT", symbol)
        profile = StockProfile(**local)
        profile_cache[cache_key] = profile
        return profile

    logger.info("[profile:%s] cache MISS — fetching profile...", symbol)
    t0 = time.time()

    try:
        df = await _get_spot_df()
    except (AKShareAdapterError, ColumnValidationError) as e:
        logger.error("[profile:%s] data source error: %s", symbol, e)
        raise HTTPException(status_code=502, detail=f"Data source error: {e}")

    row = df[df["代码"] == symbol]
    if row.empty:
        raise HTTPException(status_code=404, detail=f"Stock {symbol} not found")
    row = row.iloc[0]

    # Fetch industry from stock_individual_info_em
    industry = "未知"
    try:
        t1 = time.time()
        info_df = await asyncio.to_thread(fetch_stock_info, symbol)
        info_map = dict(zip(info_df["item"], info_df["value"]))
        industry = str(info_map.get("行业", "未知"))
        logger.info("[profile:%s] stock_info fetched in %.2fs, industry=%s", symbol, time.time() - t1, industry)
    except Exception as e:
        logger.warning("[profile:%s] stock_info failed: %s", symbol, e)

    code = str(row["代码"])
    profile = StockProfile(
        symbol=code,
        name=str(row["名称"]),
        market=_detect_market(code),
        industry=industry,
        currentPrice=float(row.get("最新价", 0) or 0),
        change=float(row.get("涨跌额", 0) or 0),
        changePercent=float(row.get("涨跌幅", 0) or 0),
        marketCap=float(row.get("总市值", 0) or 0),
        pe=float(row.get("市盈率-动态", 0) or 0),
        pb=float(row.get("市净率", 0) or 0),
        dividendYield=0.0,
        turnoverRate=float(row.get("换手率", 0) or 0),
        volume=float(row.get("成交量", 0) or 0),
        updateTime=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        open=float(row.get("今开", 0) or 0),
        high=float(row.get("最高", 0) or 0),
        low=float(row.get("最低", 0) or 0),
        previousClose=float(row.get("昨收", 0) or 0),
        amplitude=float(row.get("振幅", 0) or 0),
        turnoverAmount=float(row.get("成交额", 0) or 0),
        freeFloatMarketCap=float(row.get("流通市值", 0) or 0),
        change60d=float(row.get("60日涨跌幅", 0) or 0),
        changeYtd=float(row.get("年初至今涨跌幅", 0) or 0),
        volumeRatio=float(row.get("量比", 0) or 0),
    )

    logger.info("[profile:%s] done in %.2fs — %s (%s)", symbol, time.time() - t0, profile.name, profile.industry)
    profile_cache[cache_key] = profile
    data_store.save_stock_data(symbol, "profile", profile.model_dump())
    return profile


async def get_kline_data(symbol: str, period: str = "day") -> list[KLineData]:
    cache_key = f"kline:{symbol}:{period}"
    if cache_key in kline_cache:
        logger.info("[kline:%s:%s] cache HIT → %d records", symbol, period, len(kline_cache[cache_key]))
        return kline_cache[cache_key]

    # Try local data store first
    local = data_store.load_stock_data(symbol, f"kline_{period}")
    if local is not None:
        logger.info("[kline:%s:%s] local HIT → %d records", symbol, period, len(local))
        result = [KLineData(**item) for item in local]
        kline_cache[cache_key] = result
        return result

    logger.info("[kline:%s:%s] cache MISS — fetching...", symbol, period)
    t0 = time.time()

    period_map = {"day": "daily", "week": "weekly", "month": "monthly"}
    ak_period = period_map.get(period, "daily")

    try:
        df = await asyncio.to_thread(
            fetch_stock_hist, symbol, ak_period, "", "", "qfq"
        )
    except (AKShareAdapterError, ColumnValidationError) as e:
        raise HTTPException(status_code=502, detail=f"K-line data error: {e}")
    except Exception as e:
        logger.error("Unexpected error fetching kline for %s: %s", symbol, e)
        raise HTTPException(status_code=502, detail=f"K-line data error: {e}")

    closes = df["收盘"].tolist()

    def ma(n: int, idx: int) -> float | None:
        if idx < n - 1:
            return None
        return round(sum(closes[idx - n + 1 : idx + 1]) / n, 2)

    result = []
    for i, (_, row) in enumerate(df.iterrows()):
        result.append(
            KLineData(
                date=str(row["日期"]),
                open=float(row["开盘"]),
                high=float(row["最高"]),
                low=float(row["最低"]),
                close=float(row["收盘"]),
                volume=float(row["成交量"]),
                ma5=ma(5, i),
                ma10=ma(10, i),
                ma20=ma(20, i),
                ma60=ma(60, i),
            )
        )

    elapsed = time.time() - t0
    logger.info("[kline:%s:%s] %d records in %.2fs", symbol, period, len(result), elapsed)
    kline_cache[cache_key] = result
    data_store.save_stock_data(symbol, f"kline_{period}", [item.model_dump() for item in result])
    return result


def _assemble_financials(
    profit_df, balance_df, cashflow_df, years: int = 100
) -> list[FinancialStatement]:
    """Assemble FinancialStatement list from raw DataFrames (annual reports only)."""
    results = []
    for _, row in profit_df.head(years).iterrows():
        report_date = str(row.get("报告日", ""))
        try:
            year = int(report_date[:4])
        except (ValueError, TypeError):
            continue

        revenue = float(row.get("营业总收入", 0) or 0)
        net_profit = float(
            row.get("归属于母公司所有者的净利润", row.get("净利润", 0)) or 0
        )
        total_assets = 0.0
        total_liabilities = 0.0
        equity = 0.0

        if balance_df is not None:
            b_row = balance_df[
                balance_df["报告日"].astype(str).str.startswith(str(year))
            ]
            if not b_row.empty:
                b_row = b_row.iloc[0]
                total_assets = float(b_row.get("资产总计", 0) or 0)
                total_liabilities = float(b_row.get("负债合计", 0) or 0)
                equity = float(
                    b_row.get(
                        "归属于母公司股东权益合计",
                        b_row.get("所有者权益(或股东权益)合计", 0),
                    )
                    or 0
                )

        operating_cashflow = 0.0
        investing_cashflow = 0.0
        financing_cashflow = 0.0
        if cashflow_df is not None:
            c_row = cashflow_df[
                cashflow_df["报告日"].astype(str).str.startswith(str(year))
            ]
            if not c_row.empty:
                c = c_row.iloc[0]
                operating_cashflow = float(c.get("经营活动产生的现金流量净额", 0) or 0)
                investing_cashflow = float(c.get("投资活动产生的现金流量净额", 0) or 0)
                financing_cashflow = float(c.get("筹资活动产生的现金流量净额", 0) or 0)

        gross_margin = 0.0
        if revenue > 0:
            cost = float(row.get("营业成本", 0) or 0)
            gross_margin = (
                round((revenue - cost) / revenue * 100, 1) if cost > 0 else 0.0
            )

        roe = 0.0
        if equity > 0 and net_profit > 0:
            roe = round(net_profit / equity * 100, 1)

        results.append(
            FinancialStatement(
                year=year,
                revenue=revenue,
                netProfit=net_profit,
                grossMargin=gross_margin,
                roe=roe,
                operatingCashFlow=operating_cashflow,
                totalAssets=total_assets,
                totalLiabilities=total_liabilities,
                equity=equity,
                eps=float(row.get("基本每股收益", 0) or 0),
                operatingProfit=float(row.get("营业利润", 0) or 0),
                totalProfitBeforeTax=float(row.get("利润总额", 0) or 0),
                totalOperatingCost=float(row.get("营业总成本", 0) or 0),
                rdExpense=float(row.get("研发费用", 0) or 0),
                financeExpense=float(row.get("财务费用", 0) or 0),
                investingCashFlow=investing_cashflow,
                financingCashFlow=financing_cashflow,
            )
        )
    return results


async def get_financials(symbol: str) -> list[FinancialStatement]:
    cache_key = f"financials:{symbol}"
    if cache_key in financials_cache:
        logger.info("[financials:%s] cache HIT → %d records", symbol, len(financials_cache[cache_key]))
        return financials_cache[cache_key]

    # Try local data store first
    local = data_store.load_stock_data(symbol, "financials")
    if local is not None:
        logger.info("[financials:%s] local HIT → %d records", symbol, len(local))
        result = [FinancialStatement(**item) for item in local]
        financials_cache[cache_key] = result
        return result

    logger.info("[financials:%s] cache MISS — fetching 3 reports in parallel...", symbol)
    t0 = time.time()

    # Fetch all three report types in parallel
    profit_df, balance_df, cashflow_df = await asyncio.gather(
        asyncio.to_thread(fetch_financial_report, symbol, "profit"),
        asyncio.to_thread(fetch_financial_report, symbol, "balance"),
        asyncio.to_thread(fetch_financial_report, symbol, "cashflow"),
    )

    fetch_elapsed = time.time() - t0
    logger.info("[financials:%s] parallel fetch done in %.2fs — profit=%s, balance=%s, cashflow=%s",
                symbol, fetch_elapsed,
                f"{len(profit_df)} rows" if profit_df is not None else "None",
                f"{len(balance_df)} rows" if balance_df is not None else "None",
                f"{len(cashflow_df)} rows" if cashflow_df is not None else "None")

    if profit_df is None:
        logger.warning("[financials:%s] no profit data, returning empty", symbol)
        return []

    # Filter to annual reports only (报告日 ends with 1231)
    profit_df = profit_df[profit_df["报告日"].astype(str).str.endswith("1231")]
    if balance_df is not None:
        balance_df = balance_df[balance_df["报告日"].astype(str).str.endswith("1231")]
    if cashflow_df is not None:
        cashflow_df = cashflow_df[cashflow_df["报告日"].astype(str).str.endswith("1231")]

    results = _assemble_financials(profit_df, balance_df, cashflow_df)

    elapsed = time.time() - t0
    logger.info("[financials:%s] %d annual reports in %.2fs", symbol, len(results), elapsed)
    financials_cache[cache_key] = results
    data_store.save_stock_data(symbol, "financials", [item.model_dump() for item in results])
    return results


async def get_news(symbol: str) -> list[StockDocument]:
    cache_key = f"news:{symbol}"
    if cache_key in news_cache:
        logger.info("[news:%s] cache HIT → %d items", symbol, len(news_cache[cache_key]))
        return news_cache[cache_key]

    # Try local data store first
    local = data_store.load_stock_data(symbol, "news")
    if local is not None:
        logger.info("[news:%s] local HIT → %d items", symbol, len(local))
        result = [StockDocument(**item) for item in local]
        news_cache[cache_key] = result
        return result

    logger.info("[news:%s] cache MISS — fetching...", symbol)
    t0 = time.time()

    try:
        df = await asyncio.to_thread(fetch_stock_news, symbol)
    except AKShareAdapterError as e:
        logger.warning("[news:%s] not available: %s", symbol, e)
        return []
    except Exception as e:
        logger.warning("[news:%s] failed: %s", symbol, e)
        return []

    results = []
    for i, (_, row) in enumerate(df.iterrows()):
        title = str(row.get("新闻标题", ""))
        source = str(row.get("文章来源", ""))
        pub_time = str(row.get("发布时间", ""))
        url = str(row.get("新闻链接", "")) or None
        content = str(row.get("新闻内容", ""))

        sentiment = "neutral"
        positive_kw = ["利好", "增长", "突破", "新高", "增持", "买入", "上调"]
        negative_kw = ["利空", "下跌", "减持", "卖出", "风险", "下调", "亏损"]
        text = title + content
        if any(kw in text for kw in positive_kw):
            sentiment = "positive"
        elif any(kw in text for kw in negative_kw):
            sentiment = "negative"

        doc_type = "news"
        if "公告" in source or "巨潮" in source:
            doc_type = "announcement"
        elif "研报" in source or "券商" in source:
            doc_type = "report"

        results.append(
            StockDocument(
                id=str(i),
                title=title,
                type=doc_type,
                publishTime=pub_time,
                source=source,
                summary=content[:200] if content else title,
                sentiment=sentiment,
                risks=[],
                url=url,
            )
        )

    elapsed = time.time() - t0
    logger.info("[news:%s] %d items in %.2fs", symbol, len(results), elapsed)
    news_cache[cache_key] = results
    data_store.save_stock_data(symbol, "news", [item.model_dump() for item in results])
    return results


def _compute_market_stats(closes: list[float], profile: StockProfile | None = None) -> MarketStats:
    n = len(closes)

    def pct_change(days: int) -> float:
        if n <= days or days <= 0:
            return 0.0
        return round((closes[-1] / closes[-1 - days] - 1) * 100, 2)

    change5d = pct_change(5)
    change20d = pct_change(20)
    change60d = profile.change60d if profile else pct_change(60)
    changeYtd = profile.changeYtd if profile else 0.0

    # 20-day annualized volatility
    volatility = 0.0
    if n >= 21:
        returns = [(closes[i] / closes[i - 1] - 1) for i in range(n - 20, n)]
        avg = sum(returns) / len(returns)
        var = sum((r - avg) ** 2 for r in returns) / (len(returns) - 1)
        volatility = round(math.sqrt(var) * math.sqrt(252) * 100, 2)

    # Max drawdown over available data
    max_drawdown = 0.0
    peak = closes[0]
    for c in closes:
        if c > peak:
            peak = c
        dd = (c - peak) / peak * 100
        if dd < max_drawdown:
            max_drawdown = dd
    max_drawdown = round(max_drawdown, 2)

    return MarketStats(
        change5d=change5d,
        change20d=change20d,
        change60d=change60d,
        changeYtd=changeYtd,
        volatility=volatility,
        maxDrawdown=max_drawdown,
    )


def _compute_technical_indicators(kline: list[KLineData]) -> TechnicalIndicators:
    closes = [k.close for k in kline]
    n = len(closes)

    # Latest MA values
    ma5 = kline[-1].ma5 if n >= 5 else None
    ma10 = kline[-1].ma10 if n >= 10 else None
    ma20 = kline[-1].ma20 if n >= 20 else None
    ma60 = kline[-1].ma60 if n >= 60 else None

    # MA signal
    ma_signal = "数据不足"
    ma_desc = "需要更多K线数据"
    if ma5 is not None and ma10 is not None and ma20 is not None and ma60 is not None:
        if ma5 > ma10 and ma20 > ma60:
            ma_signal = "多头排列"
            ma_desc = "短期均线在上方，中期趋势向好"
        elif ma5 < ma10 and ma20 < ma60:
            ma_signal = "空头排列"
            ma_desc = "短期均线在下方，中期趋势偏弱"
        elif ma5 > ma10 and ma20 < ma60:
            ma_signal = "短期偏多"
            ma_desc = "短期走强但中期偏弱"
        elif ma5 < ma10 and ma20 > ma60:
            ma_signal = "短期偏空"
            ma_desc = "短期走弱但中期偏强"
        else:
            ma_signal = "震荡"
            ma_desc = "均线交织，方向不明"

    # MACD (12, 26, 9)
    macd_dif = macd_dea = macd_value = 0.0
    macd_signal = "数据不足"
    macd_desc = ""
    if n >= 26:
        ema12 = closes[0]
        ema26 = closes[0]
        dif_list = []
        for c in closes:
            ema12 = ema12 * 11 / 13 + c * 2 / 13
            ema26 = ema26 * 25 / 27 + c * 2 / 27
            dif_list.append(ema12 - ema26)
        # DEA = EMA9 of DIF
        dea = dif_list[0]
        for d in dif_list:
            dea = dea * 8 / 10 + d * 2 / 10
        macd_dif = round(dif_list[-1], 4)
        macd_dea = round(dea, 4)
        macd_value = round(2 * (macd_dif - macd_dea), 4)
        if macd_dif > macd_dea:
            macd_signal = "多头"
            macd_desc = f"DIF({macd_dif:.3f})在DEA({macd_dea:.3f})之上"
        else:
            macd_signal = "空头"
            macd_desc = f"DIF({macd_dif:.3f})在DEA({macd_dea:.3f})之下"

    # RSI(14)
    rsi_value = 50.0
    rsi_signal = "数据不足"
    rsi_desc = ""
    if n >= 15:
        gains = []
        losses = []
        for i in range(n - 14, n):
            diff = closes[i] - closes[i - 1]
            if diff > 0:
                gains.append(diff)
                losses.append(0)
            else:
                gains.append(0)
                losses.append(-diff)
        avg_gain = sum(gains) / 14
        avg_loss = sum(losses) / 14
        if avg_loss == 0:
            rsi_value = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi_value = round(100 - 100 / (1 + rs), 2)
        if rsi_value >= 70:
            rsi_signal = "超买"
            rsi_desc = f"RSI={rsi_value:.1f}，进入超买区间"
        elif rsi_value <= 30:
            rsi_signal = "超卖"
            rsi_desc = f"RSI={rsi_value:.1f}，进入超卖区间"
        else:
            rsi_signal = "中性"
            rsi_desc = f"RSI={rsi_value:.1f}，未进入极端区间"

    # Bollinger Bands (20, 2)
    boll_upper = boll_middle = boll_lower = 0.0
    boll_position = "数据不足"
    boll_signal = ""
    boll_desc = ""
    if n >= 20:
        recent20 = closes[-20:]
        boll_middle = round(sum(recent20) / 20, 2)
        std = math.sqrt(sum((c - boll_middle) ** 2 for c in recent20) / 20)
        boll_upper = round(boll_middle + 2 * std, 2)
        boll_lower = round(boll_middle - 2 * std, 2)
        last = closes[-1]
        if last > boll_upper:
            boll_position = "上轨上方"
            boll_signal = "偏强"
            boll_desc = f"价格({last:.2f})突破上轨({boll_upper:.2f})"
        elif last > boll_middle:
            boll_position = "中轨上方"
            boll_signal = "偏多"
            boll_desc = f"价格({last:.2f})在中轨({boll_middle:.2f})上方"
        elif last > boll_lower:
            boll_position = "中轨下方"
            boll_signal = "偏空"
            boll_desc = f"价格({last:.2f})在中轨({boll_middle:.2f})下方"
        else:
            boll_position = "下轨下方"
            boll_signal = "偏弱"
            boll_desc = f"价格({last:.2f})跌破下轨({boll_lower:.2f})"

    return TechnicalIndicators(
        ma5=ma5, ma10=ma10, ma20=ma20, ma60=ma60,
        maSignal=ma_signal, maDesc=ma_desc,
        macdDif=macd_dif, macdDea=macd_dea, macdValue=macd_value,
        macdSignal=macd_signal, macdDesc=macd_desc,
        rsiValue=rsi_value, rsiSignal=rsi_signal, rsiDesc=rsi_desc,
        bollingerUpper=boll_upper, bollingerMiddle=boll_middle, bollingerLower=boll_lower,
        bollingerPosition=boll_position, bollingerSignal=boll_signal, bollingerDesc=boll_desc,
    )


async def get_stock_stats(symbol: str) -> StockStats:
    """Compute market stats and technical indicators from kline data."""
    cache_key = f"stats:{symbol}"
    # Try local data store
    local = data_store.load_stock_data(symbol, "stats")
    if local is not None:
        try:
            return StockStats(**local)
        except Exception:
            pass

    # Get kline data (daily, 120 days is enough)
    kline = await get_kline_data(symbol, "day")
    if not kline:
        raise HTTPException(status_code=404, detail=f"No kline data for {symbol}")

    closes = [k.close for k in kline]

    # Get profile for change60d/changeYtd
    profile = None
    try:
        profile = await get_stock_profile(symbol)
    except Exception:
        pass

    market_stats = _compute_market_stats(closes, profile)
    tech_indicators = _compute_technical_indicators(kline)

    result = StockStats(marketStats=market_stats, technicalIndicators=tech_indicators)
    data_store.save_stock_data(symbol, "stats", result.model_dump())
    return result


async def get_dividends(symbol: str) -> list[DividendRecord]:
    cache_key = f"dividends:{symbol}"
    if cache_key in financials_cache:
        return financials_cache[cache_key]

    local = data_store.load_stock_data(symbol, "dividends")
    if local is not None:
        result = [DividendRecord(**item) for item in local]
        financials_cache[cache_key] = result
        return result

    df = await asyncio.to_thread(fetch_dividend_data, symbol)
    if df is None or df.empty:
        return []

    results = []
    for _, row in df.iterrows():
        report_date = str(row.get("报告日", ""))
        try:
            year = int(report_date[:4])
        except (ValueError, TypeError):
            continue

        results.append(DividendRecord(
            year=year,
            dividendPerShare=float(row.get("派息", 0) or 0),
            bonusShares=float(row.get("送股", 0) or 0),
            reservePerShare=float(row.get("转增", 0) or 0),
            exDate=str(row.get("除权除息日", "")),
            recordDate=str(row.get("股权登记日", "")),
        ))

    financials_cache[cache_key] = results
    data_store.save_stock_data(symbol, "dividends", [item.model_dump() for item in results])
    return results
