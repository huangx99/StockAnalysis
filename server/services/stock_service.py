import asyncio
import hashlib
import json
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path
from io import BytesIO
from urllib.parse import urlparse, parse_qs, unquote

import requests as http_requests
from fastapi import HTTPException
import pandas as pd

from adapters.akshare_adapter import (
    AKShareAdapterError,
    ColumnValidationError,
    fetch_all_stocks,
    fetch_stock_hist,
    fetch_stock_info,
    fetch_stock_news,
    fetch_financial_report,
    fetch_financial_report_em,
    fetch_financial_indicators,
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
    FinancialPeriodMetrics,
    FinancialScores,
    FinancialAlert,
    FinancialSummary,
    FinancialStatementsResponse,
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


async def get_kline_data(symbol: str, period: str = "day", limit: int = 0) -> list[KLineData]:
    cache_key = f"kline:{symbol}:{period}"
    if cache_key in kline_cache:
        full = kline_cache[cache_key]
        result = full[-limit:] if limit > 0 else full
        logger.info("[kline:%s:%s] cache HIT → %d records (limit=%d)", symbol, period, len(result), limit)
        return result

    # Try local data store first
    local = data_store.load_stock_data(symbol, f"kline_{period}")
    if local is not None:
        logger.info("[kline:%s:%s] local HIT → %d records", symbol, period, len(local))
        full = [KLineData(**item) for item in local]
        kline_cache[cache_key] = full
        result = full[-limit:] if limit > 0 else full
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


def _safe_float(value, default: float = 0.0) -> float:
    try:
        if value is None or pd.isna(value):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_pct(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return 0.0
    return round(numerator / denominator * 100, 2)


def _report_quarter(report_date: str) -> str:
    if report_date.endswith("03-31") or report_date.endswith("0331"):
        return "Q1"
    if report_date.endswith("06-30") or report_date.endswith("0630"):
        return "H1"
    if report_date.endswith("09-30") or report_date.endswith("0930"):
        return "Q3"
    return "FY"


def _normalize_report_date(value) -> str:
    if value is None or pd.isna(value):
        return ""
    text = str(value)
    if " " in text:
        text = text.split(" ")[0]
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    return text[:10]


def _records_from_df(df) -> list[dict]:
    if df is None:
        return []
    return json.loads(df.where(pd.notnull(df), None).to_json(orient="records", force_ascii=False, date_format="iso"))


def _row_by_report_date(df, report_date: str):
    if df is None or df.empty or "REPORT_DATE" not in df.columns:
        return None
    dates = df["REPORT_DATE"].apply(_normalize_report_date)
    matched = df[dates == report_date]
    if matched.empty:
        return None
    return matched.iloc[0]


def _indicator_by_report_date(indicator_df, report_date: str):
    if indicator_df is None or indicator_df.empty or "日期" not in indicator_df.columns:
        return None
    dates = indicator_df["日期"].apply(_normalize_report_date)
    matched = indicator_df[dates == report_date]
    if matched.empty:
        return None
    return matched.iloc[0]


def _assemble_financial_periods(symbol: str, income_df, balance_df, cashflow_df, indicator_df=None) -> list[FinancialPeriodMetrics]:
    if income_df is None or income_df.empty:
        return []

    periods: list[FinancialPeriodMetrics] = []
    for _, income in income_df.iterrows():
        report_date = _normalize_report_date(income.get("REPORT_DATE"))
        if not report_date:
            continue
        try:
            report_year = int(report_date[:4])
        except ValueError:
            continue

        balance = _row_by_report_date(balance_df, report_date)
        cashflow = _row_by_report_date(cashflow_df, report_date)
        indicator = _indicator_by_report_date(indicator_df, report_date)

        revenue = _safe_float(income.get("TOTAL_OPERATE_INCOME", income.get("OPERATE_INCOME")))
        operating_cost = _safe_float(income.get("OPERATE_COST"))
        net_profit = _safe_float(income.get("PARENT_NETPROFIT", income.get("NETPROFIT")))
        total_assets = _safe_float(balance.get("TOTAL_ASSETS")) if balance is not None else 0.0
        total_liabilities = _safe_float(balance.get("TOTAL_LIABILITIES")) if balance is not None else 0.0
        equity = _safe_float(balance.get("TOTAL_PARENT_EQUITY", balance.get("TOTAL_EQUITY"))) if balance is not None else 0.0
        operating_cashflow = _safe_float(cashflow.get("NETCASH_OPERATE")) if cashflow is not None else 0.0
        capex = _safe_float(cashflow.get("CONSTRUCT_LONG_ASSET")) if cashflow is not None else 0.0
        gross_profit = revenue - operating_cost if revenue and operating_cost else 0.0

        periods.append(FinancialPeriodMetrics(
            symbol=symbol,
            reportDate=report_date,
            reportYear=report_year,
            reportQuarter=_report_quarter(report_date),
            reportType=str(income.get("REPORT_TYPE", "") or ""),
            noticeDate=_normalize_report_date(income.get("NOTICE_DATE")),
            currency=str(income.get("CURRENCY", "CNY") or "CNY"),
            source="eastmoney",
            revenue=revenue,
            revenueYoY=_safe_float(income.get("TOTAL_OPERATE_INCOME_YOY", income.get("OPERATE_INCOME_YOY"))),
            operatingCost=operating_cost,
            grossProfit=gross_profit,
            grossMargin=_safe_float(indicator.get("销售毛利率(%)")) if indicator is not None else _safe_pct(gross_profit, revenue),
            salesExpense=_safe_float(income.get("SALE_EXPENSE")),
            manageExpense=_safe_float(income.get("MANAGE_EXPENSE")),
            rdExpense=_safe_float(income.get("RESEARCH_EXPENSE", income.get("ME_RESEARCH_EXPENSE"))),
            financeExpense=_safe_float(income.get("FINANCE_EXPENSE")),
            operatingProfit=_safe_float(income.get("OPERATE_PROFIT")),
            totalProfit=_safe_float(income.get("TOTAL_PROFIT")),
            netProfit=net_profit,
            netProfitYoY=_safe_float(income.get("PARENT_NETPROFIT_YOY", income.get("NETPROFIT_YOY"))),
            deductedNetProfit=_safe_float(income.get("DEDUCT_PARENT_NETPROFIT")),
            eps=_safe_float(income.get("BASIC_EPS")),
            netMargin=_safe_float(indicator.get("销售净利率(%)")) if indicator is not None else _safe_pct(net_profit, revenue),
            roe=_safe_float(indicator.get("净资产收益率(%)")) if indicator is not None else _safe_pct(net_profit, equity),
            roa=_safe_float(indicator.get("总资产净利润率(%)")) if indicator is not None else _safe_pct(net_profit, total_assets),
            totalAssets=total_assets,
            totalLiabilities=total_liabilities,
            equity=equity,
            cash=_safe_float(balance.get("MONETARYFUNDS")) if balance is not None else 0.0,
            accountsReceivable=_safe_float(balance.get("ACCOUNTS_RECE")) if balance is not None else 0.0,
            inventory=_safe_float(balance.get("INVENTORY")) if balance is not None else 0.0,
            contractLiability=_safe_float(balance.get("CONTRACT_LIAB")) if balance is not None else 0.0,
            goodwill=_safe_float(balance.get("GOODWILL")) if balance is not None else 0.0,
            debtAssetRatio=_safe_float(indicator.get("资产负债率(%)")) if indicator is not None else _safe_pct(total_liabilities, total_assets),
            currentRatio=_safe_float(indicator.get("流动比率")) if indicator is not None else 0.0,
            quickRatio=_safe_float(indicator.get("速动比率")) if indicator is not None else 0.0,
            assetTurnover=_safe_float(indicator.get("总资产周转率(次)")) if indicator is not None else 0.0,
            receivableTurnover=_safe_float(indicator.get("应收账款周转率(次)")) if indicator is not None else 0.0,
            inventoryTurnover=_safe_float(indicator.get("存货周转率(次)")) if indicator is not None else 0.0,
            operatingCashFlow=operating_cashflow,
            operatingCashFlowYoY=_safe_float(cashflow.get("NETCASH_OPERATE_YOY")) if cashflow is not None else 0.0,
            investingCashFlow=_safe_float(cashflow.get("NETCASH_INVEST")) if cashflow is not None else 0.0,
            financingCashFlow=_safe_float(cashflow.get("NETCASH_FINANCE")) if cashflow is not None else 0.0,
            capex=capex,
            freeCashFlow=operating_cashflow - capex,
            cfoToNetProfit=_safe_float(indicator.get("经营现金净流量与净利润的比率(%)")) if indicator is not None else _safe_pct(operating_cashflow, net_profit),
        ))

    periods.sort(key=lambda item: item.reportDate, reverse=True)
    return periods


def _annual_legacy_from_periods(periods: list[FinancialPeriodMetrics]) -> list[FinancialStatement]:
    annual = [p for p in periods if p.reportQuarter == "FY"]
    return [FinancialStatement(
        year=p.reportYear,
        revenue=p.revenue,
        netProfit=p.netProfit,
        grossMargin=p.grossMargin,
        roe=p.roe,
        operatingCashFlow=p.operatingCashFlow,
        totalAssets=p.totalAssets,
        totalLiabilities=p.totalLiabilities,
        equity=p.equity,
        eps=p.eps,
        operatingProfit=p.operatingProfit,
        totalProfitBeforeTax=p.totalProfit,
        totalOperatingCost=p.operatingCost,
        rdExpense=p.rdExpense,
        financeExpense=p.financeExpense,
        investingCashFlow=p.investingCashFlow,
        financingCashFlow=p.financingCashFlow,
    ) for p in annual]


def _score_metric(value: float, good: float, okay: float, higher_is_better: bool = True) -> int:
    if higher_is_better:
        if value >= good:
            return 90
        if value >= okay:
            return 70
        return 45
    if value <= good:
        return 90
    if value <= okay:
        return 70
    return 45


def _build_financial_summary(symbol: str, periods: list[FinancialPeriodMetrics]) -> FinancialSummary:
    latest = periods[0] if periods else None
    annual = [p for p in periods if p.reportQuarter == "FY"][:10]
    quarterly = periods[:12]
    alerts: list[FinancialAlert] = []

    if latest:
        if latest.netProfit > 0 and latest.cfoToNetProfit < 50:
            alerts.append(FinancialAlert(
                level="warning",
                title="利润现金含量偏低",
                message=f"{latest.reportDate} 经营现金流/净利润为 {latest.cfoToNetProfit:.1f}%，利润转化为现金的质量需要关注。",
                metric="cfoToNetProfit",
                period=latest.reportDate,
            ))
        if latest.revenueYoY > 0 and latest.netProfitYoY < 0:
            alerts.append(FinancialAlert(
                level="warning",
                title="增收不增利",
                message=f"营收同比 {latest.revenueYoY:.1f}%，净利润同比 {latest.netProfitYoY:.1f}%，盈利弹性转弱。",
                metric="netProfitYoY",
                period=latest.reportDate,
            ))
        if latest.debtAssetRatio > 70:
            alerts.append(FinancialAlert(
                level="danger",
                title="资产负债率较高",
                message=f"资产负债率 {latest.debtAssetRatio:.1f}%，需关注杠杆和流动性压力。",
                metric="debtAssetRatio",
                period=latest.reportDate,
            ))
        if latest.goodwill > 0 and latest.equity > 0 and latest.goodwill / latest.equity > 0.2:
            alerts.append(FinancialAlert(
                level="warning",
                title="商誉占比较高",
                message="商誉超过归母权益 20%，需关注潜在减值风险。",
                metric="goodwill",
                period=latest.reportDate,
            ))

    if len(quarterly) >= 3:
        recent = quarterly[:3]
        if all(item.grossMargin > 0 for item in recent) and recent[0].grossMargin < recent[1].grossMargin < recent[2].grossMargin:
            alerts.append(FinancialAlert(
                level="info",
                title="毛利率连续下降",
                message="最近 3 期毛利率连续下降，需关注产品价格或成本压力。",
                metric="grossMargin",
                period=recent[0].reportDate,
            ))

    scores = FinancialScores()
    if latest:
        scores.growth = round((_score_metric(latest.revenueYoY, 15, 5) + _score_metric(latest.netProfitYoY, 15, 5)) / 2)
        scores.profitability = round((_score_metric(latest.roe, 15, 8) + _score_metric(latest.netMargin, 15, 5)) / 2)
        scores.cashflow = _score_metric(latest.cfoToNetProfit, 100, 60)
        scores.solvency = round((_score_metric(latest.debtAssetRatio, 40, 65, False) + _score_metric(latest.currentRatio, 2, 1)) / 2)
        scores.efficiency = _score_metric(latest.assetTurnover, 0.7, 0.3)
        scores.shareholderReturn = 70
        scores.total = round((scores.growth + scores.profitability + scores.cashflow + scores.solvency + scores.efficiency + scores.shareholderReturn) / 6)

    return FinancialSummary(
        symbol=symbol,
        latestPeriod=latest,
        annual=annual,
        quarterly=quarterly,
        scores=scores,
        alerts=alerts,
        dataSource="eastmoney+akshare",
        updatedAt=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )


async def get_financial_periods(symbol: str, period: str = "quarter", limit: int = 20) -> list[FinancialPeriodMetrics]:
    local = data_store.load_stock_data(symbol, "financial_periods")
    if isinstance(local, list) and local:
        periods = [FinancialPeriodMetrics(**item) for item in local]
        filtered = [p for p in periods if period != "annual" or p.reportQuarter == "FY"]
        return filtered[:limit] if limit > 0 else filtered

    income_df, balance_df, cashflow_df, indicator_df = await asyncio.gather(
        asyncio.to_thread(fetch_financial_report_em, symbol, "income"),
        asyncio.to_thread(fetch_financial_report_em, symbol, "balance"),
        asyncio.to_thread(fetch_financial_report_em, symbol, "cashflow"),
        asyncio.to_thread(fetch_financial_indicators, symbol, "2016"),
    )

    if income_df is None:
        logger.warning("[financial_periods:%s] EastMoney missing, fallback to legacy annual reports", symbol)
        return []

    data_store.save_stock_data(symbol, "financial_income_raw", _records_from_df(income_df))
    data_store.save_stock_data(symbol, "financial_balance_raw", _records_from_df(balance_df))
    data_store.save_stock_data(symbol, "financial_cashflow_raw", _records_from_df(cashflow_df))
    data_store.save_stock_data(symbol, "financial_indicator_raw", _records_from_df(indicator_df))

    periods = _assemble_financial_periods(symbol, income_df, balance_df, cashflow_df, indicator_df)
    data_store.save_stock_data(symbol, "financial_periods", [item.model_dump() for item in periods])
    summary = _build_financial_summary(symbol, periods)
    data_store.save_stock_data(symbol, "financial_summary", summary.model_dump())
    data_store.save_stock_data(symbol, "financials", [item.model_dump() for item in _annual_legacy_from_periods(periods)])

    filtered = [p for p in periods if period != "annual" or p.reportQuarter == "FY"]
    return filtered[:limit] if limit > 0 else filtered


async def get_financial_summary(symbol: str) -> FinancialSummary:
    local = data_store.load_stock_data(symbol, "financial_summary")
    if isinstance(local, dict) and local:
        try:
            return FinancialSummary(**local)
        except Exception:
            pass
    periods = await get_financial_periods(symbol, "quarter", 0)
    summary = _build_financial_summary(symbol, periods)
    data_store.save_stock_data(symbol, "financial_summary", summary.model_dump())
    return summary


async def get_financial_statements(symbol: str, statement_type: str, period: str = "quarter") -> FinancialStatementsResponse:
    data_type_map = {
        "income": "financial_income_raw",
        "balance": "financial_balance_raw",
        "cashflow": "financial_cashflow_raw",
    }
    data_type = data_type_map.get(statement_type)
    if data_type is None:
        raise HTTPException(status_code=400, detail="Invalid statement type")
    local = data_store.load_stock_data(symbol, data_type)
    if not isinstance(local, list) or not local:
        await get_financial_periods(symbol, "quarter", 0)
        local = data_store.load_stock_data(symbol, data_type)
    rows = local if isinstance(local, list) else []
    if period == "annual":
        rows = [row for row in rows if _report_quarter(_normalize_report_date(row.get("REPORT_DATE"))) == "FY"]
    return FinancialStatementsResponse(symbol=symbol, statementType=statement_type, rows=rows)


async def get_financial_ratios(symbol: str, period: str = "quarter", limit: int = 20) -> list[dict]:
    periods = await get_financial_periods(symbol, period, limit)
    return [{
        "reportDate": item.reportDate,
        "reportQuarter": item.reportQuarter,
        "grossMargin": item.grossMargin,
        "netMargin": item.netMargin,
        "roe": item.roe,
        "roa": item.roa,
        "debtAssetRatio": item.debtAssetRatio,
        "currentRatio": item.currentRatio,
        "quickRatio": item.quickRatio,
        "assetTurnover": item.assetTurnover,
        "receivableTurnover": item.receivableTurnover,
        "inventoryTurnover": item.inventoryTurnover,
        "cfoToNetProfit": item.cfoToNetProfit,
    } for item in periods]


async def get_financial_valuation(symbol: str) -> dict:
    profile, summary = await asyncio.gather(
        get_stock_profile(symbol),
        get_financial_summary(symbol),
    )
    latest = summary.latestPeriod
    market_cap = profile.marketCap
    revenue = latest.revenue if latest else 0.0
    net_profit = latest.netProfit if latest else 0.0
    operating_cashflow = latest.operatingCashFlow if latest else 0.0
    return {
        "symbol": symbol,
        "reportDate": latest.reportDate if latest else "",
        "marketCap": market_cap,
        "pe": profile.pe,
        "pb": profile.pb,
        "ps": round(market_cap / revenue, 2) if revenue else 0.0,
        "pcf": round(market_cap / operating_cashflow, 2) if operating_cashflow else 0.0,
        "earningsYield": _safe_pct(net_profit, market_cap),
        "dividendYield": profile.dividendYield,
        "eps": latest.eps if latest else 0.0,
        "score": summary.scores.total,
        "dataSource": "spot+financial_summary",
    }


async def get_financial_alerts(symbol: str) -> list[FinancialAlert]:
    summary = await get_financial_summary(symbol)
    return summary.alerts


async def get_financial_peers(symbol: str) -> dict:
    profile, summary = await asyncio.gather(
        get_stock_profile(symbol),
        get_financial_summary(symbol),
    )
    latest = summary.latestPeriod
    return {
        "symbol": symbol,
        "industry": profile.industry,
        "self": latest.model_dump() if latest else None,
        "benchmarks": [],
        "note": "已返回本公司标准指标；行业基准需先批量下载同行财务数据后计算。",
    }


async def get_financials(symbol: str) -> list[FinancialStatement]:
    cache_key = f"financials:{symbol}"
    if cache_key in financials_cache:
        logger.info("[financials:%s] cache HIT → %d records", symbol, len(financials_cache[cache_key]))
        return financials_cache[cache_key]

    periods_local = data_store.load_stock_data(symbol, "financial_periods")
    if isinstance(periods_local, list) and periods_local:
        periods = [FinancialPeriodMetrics(**item) for item in periods_local]
        result = _annual_legacy_from_periods(periods)
        financials_cache[cache_key] = result
        return result

    # Try local data store first
    local = data_store.load_stock_data(symbol, "financials")
    if local is not None:
        logger.info("[financials:%s] local HIT → %d records", symbol, len(local))
        result = [FinancialStatement(**item) for item in local]
        financials_cache[cache_key] = result
        return result

    try:
        periods = await get_financial_periods(symbol, "annual", 0)
        result = _annual_legacy_from_periods(periods)
        if result:
            financials_cache[cache_key] = result
            return result
    except Exception as e:
        logger.warning("[financials:%s] new financial periods failed, fallback legacy: %s", symbol, e)

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


def _load_notices_as_docs(symbol: str) -> list[StockDocument]:
    """Load stored notices as StockDocument list."""
    local = data_store.load_stock_data(symbol, "notices")
    if not isinstance(local, list):
        return []
    docs = []
    for i, item in enumerate(local):
        url = item.get("url")
        if url and isinstance(url, str):
            if " " in url:
                url = url.replace(" ", "%20")
            if url.startswith("http://"):
                url = url.replace("http://", "https://", 1)
        docs.append(StockDocument(
            id=f"notice_{i}",
            title=str(item.get("title", "")),
            type="announcement",
            publishTime=str(item.get("publishTime", "")),
            source="巨潮公告",
            summary=str(item.get("title", ""))[:200],
            content="",
            sentiment="neutral",
            risks=[],
            url=url,
        ))
    return docs


def _load_reports_as_docs(symbol: str) -> list[StockDocument]:
    """Load stored reports as StockDocument list."""
    local = data_store.load_stock_data(symbol, "reports")
    if not isinstance(local, list):
        return []
    docs = []
    for i, item in enumerate(local):
        title = str(item.get("title", ""))
        institution = str(item.get("institution", ""))
        rating = str(item.get("rating", ""))
        summary_parts = []
        if institution:
            summary_parts.append(f"机构: {institution}")
        if rating:
            summary_parts.append(f"评级: {rating}")
        url = item.get("url")
        if url and isinstance(url, str):
            if " " in url:
                url = url.replace(" ", "%20")
            if url.startswith("http://"):
                url = url.replace("http://", "https://", 1)
        docs.append(StockDocument(
            id=f"report_{i}",
            title=title,
            type="report",
            publishTime=str(item.get("publishTime", "")),
            source=institution or "券商研报",
            summary="; ".join(summary_parts) if summary_parts else title[:200],
            content="",
            sentiment="positive" if "买入" in rating or "增持" in rating else "neutral",
            risks=[],
            url=url,
        ))
    return docs


def _merge_all_docs(news_docs: list[StockDocument], symbol: str) -> list[StockDocument]:
    """Merge news, notices, and reports into a single sorted list."""
    notices = _load_notices_as_docs(symbol)
    reports = _load_reports_as_docs(symbol)
    all_docs = news_docs + notices + reports
    all_docs.sort(key=lambda x: x.publishTime, reverse=True)
    return all_docs


async def get_news(symbol: str) -> list[StockDocument]:
    cache_key = f"news:{symbol}"
    if cache_key in news_cache:
        cached = news_cache[cache_key]
        merged = _merge_all_docs(cached, symbol)
        logger.info("[news:%s] cache HIT → %d items (news:%d, notices+reports merged)", symbol, len(merged), len(cached))
        return merged

    # Try local data store first
    local = data_store.load_stock_data(symbol, "news")
    if local is not None:
        logger.info("[news:%s] local HIT → %d items", symbol, len(local))
        result = [StockDocument(**item) for item in local]
        result.sort(key=lambda x: x.publishTime, reverse=True)
        merged = _merge_all_docs(result, symbol)
        news_cache[cache_key] = result  # cache base news only; merge happens on read
        return merged

    logger.info("[news:%s] cache MISS — fetching...", symbol)
    t0 = time.time()

    try:
        df = await asyncio.to_thread(fetch_stock_news, symbol)
    except AKShareAdapterError as e:
        logger.warning("[news:%s] not available: %s", symbol, e)
        return _merge_all_docs([], symbol)
    except Exception as e:
        logger.warning("[news:%s] failed: %s", symbol, e)
        return _merge_all_docs([], symbol)

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

        results.append(
            StockDocument(
                id=f"news_{i}",
                title=title,
                type="news",
                publishTime=pub_time,
                source=source,
                summary=content[:200] if content else title,
                content=content or "",
                sentiment=sentiment,
                risks=[],
                url=url,
            )
        )

    # Sort by publishTime descending (newest first)
    results.sort(key=lambda x: x.publishTime, reverse=True)

    elapsed = time.time() - t0
    logger.info("[news:%s] fetched %d news items in %.2fs", symbol, len(results), elapsed)
    news_cache[cache_key] = results
    data_store.save_stock_data(symbol, "news", [item.model_dump() for item in results])
    merged = _merge_all_docs(results, symbol)
    return merged


async def refresh_news(symbol: str) -> dict:
    """Incrementally fetch latest news and merge with local data."""
    # Load existing news
    local = data_store.load_stock_data(symbol, "news")
    existing: list[dict] = local if isinstance(local, list) else []

    # Find newest publishTime in local data
    last_stored_time = ""
    for item in existing:
        pt = item.get("publishTime", "")
        if pt > last_stored_time:
            last_stored_time = pt

    # Fetch fresh news
    logger.info("[news:%s] refreshing — last stored time=%s", symbol, last_stored_time)
    try:
        df = await asyncio.to_thread(fetch_stock_news, symbol)
    except Exception as e:
        logger.warning("[news:%s] refresh fetch failed: %s", symbol, e)
        return {"new_count": 0, "total": len(existing)}

    # Filter new items (publishTime > last_stored_time)
    existing_titles = {(item.get("title", ""), item.get("publishTime", "")[:10]) for item in existing}
    new_items = []
    for _, row in df.iterrows():
        pub_time = str(row.get("发布时间", ""))
        title = str(row.get("新闻标题", ""))
        content = str(row.get("新闻内容", ""))
        # Only keep items newer than last stored
        if pub_time > last_stored_time:
            # Dedup: same title + same date
            key = (title, pub_time[:10])
            if key not in existing_titles:
                existing_titles.add(key)
                source = str(row.get("文章来源", ""))
                url = str(row.get("新闻链接", "")) or None
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

                new_items.append({
                    "id": f"news_{len(existing) + len(new_items)}",
                    "title": title,
                    "type": doc_type,
                    "publishTime": pub_time,
                    "source": source,
                    "summary": content[:200] if content else title,
                    "content": content or "",
                    "sentiment": sentiment,
                    "risks": [],
                    "url": url,
                })

    if new_items:
        # Merge, sort, save
        merged = existing + new_items
        merged.sort(key=lambda x: x.get("publishTime", ""), reverse=True)
        data_store.save_stock_data(symbol, "news", merged)
        # Update cache
        cache_key = f"news:{symbol}"
        news_cache[cache_key] = [StockDocument(**item) for item in merged]
        logger.info("[news:%s] refresh: %d new, %d total", symbol, len(new_items), len(merged))
    else:
        logger.info("[news:%s] refresh: no new items", symbol)

    return {"new_count": len(new_items), "total": len(existing) + len(new_items)}


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


async def get_notices(symbol: str) -> list[dict]:
    """Return stored announcement notices for a stock."""
    local = data_store.load_stock_data(symbol, "notices")
    if isinstance(local, list):
        return local
    return []


async def get_reports(symbol: str) -> list[dict]:
    """Return stored research reports for a stock."""
    local = data_store.load_stock_data(symbol, "reports")
    if isinstance(local, list):
        return local
    return []


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


def _extract_pdf_text(url: str) -> str:
    """Download a PDF and extract its text content."""
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        logger.warning("PyPDF2 not installed, cannot extract PDF text")
        return ""

    try:
        resp = http_requests.get(url, headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        }, timeout=30)
        if resp.status_code != 200:
            return ""
        reader = PdfReader(BytesIO(resp.content))
        text_parts = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                text_parts.append(t)
        return "\n".join(text_parts)
    except Exception as e:
        logger.warning("Failed to extract PDF text from %s: %s", url, e)
        return ""


async def get_notice_content(url: str) -> str:
    """
    Get the full text content of a notice/report.
    For cninfo URLs: calls their API to get the PDF, downloads and extracts text.
    Caches extracted text to disk.
    """
    if not url:
        return ""

    # Check cache
    cache_dir = Path(__file__).parent.parent / "data" / "notice_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    url_hash = hashlib.md5(url.encode()).hexdigest()
    cache_path = cache_dir / f"{url_hash}.txt"

    if cache_path.exists():
        try:
            return cache_path.read_text(encoding="utf-8")
        except Exception:
            pass

    fetch_headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}

    # Handle cninfo URLs: call their API, get PDF URL, download + extract text
    if "cninfo.com.cn" in url and "announcementId" in url:
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        announcement_id = (params.get("announcementId") or [None])[0]
        announcement_time = (params.get("announcementTime") or [None])[0]
        stock_code = (params.get("stockCode") or [None])[0]

        if not announcement_id:
            return ""

        if announcement_time:
            announcement_time = unquote(announcement_time)

        def _fetch_cninfo_pdf():
            is_szse = stock_code.startswith(("0", "3")) if stock_code else False
            api_resp = http_requests.post(
                "https://www.cninfo.com.cn/new/announcement/bulletin_detail",
                data={
                    "announceId": announcement_id,
                    "flag": "true" if is_szse else "false",
                    "announceTime": announcement_time or "",
                },
                headers=fetch_headers,
                timeout=15,
            )
            api_data = api_resp.json()
            file_url = api_data.get("fileUrl")
            if not file_url:
                adjunct = api_data.get("announcement", {}).get("adjunctUrl")
                if adjunct:
                    file_url = f"https://static.cninfo.com.cn/{adjunct}"
            if not file_url:
                return ""
            if file_url.startswith("http://"):
                file_url = file_url.replace("http://", "https://", 1)
            return _extract_pdf_text(file_url)

        try:
            text = await asyncio.to_thread(_fetch_cninfo_pdf)
            if text:
                cache_path.write_text(text, encoding="utf-8")
                return text
        except Exception as e:
            logger.warning("Failed to get notice content from %s: %s", url, e)

    # Handle direct PDF URLs (e.g., dfcfw.com reports)
    elif url.endswith(".pdf"):
        try:
            text = await asyncio.to_thread(_extract_pdf_text, url)
            if text:
                cache_path.write_text(text, encoding="utf-8")
                return text
        except Exception as e:
            logger.warning("Failed to extract PDF text from %s: %s", url, e)

    return ""
