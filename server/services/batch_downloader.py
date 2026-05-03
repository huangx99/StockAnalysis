import asyncio
import json
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path

from adapters.akshare_adapter import (
    fetch_all_stocks,
    fetch_stock_hist,
    fetch_stock_info,
    fetch_stock_news,
    fetch_financial_report,
    fetch_dividend_data,
)
from services import data_store

logger = logging.getLogger(__name__)

_download_task: asyncio.Task | None = None
_stop_flag = False
_MAX_LOGS = 500


def _append_log(logs: list[str], msg: str) -> None:
    entry = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    logs.append(entry)
    if len(logs) > _MAX_LOGS:
        del logs[:len(logs) - _MAX_LOGS]


def _load_stock_list() -> list[dict]:
    path = Path(__file__).parent.parent / "data" / "stock_list.json"
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _detect_market(code: str) -> str:
    if code.startswith("6"):
        return "SH"
    if code.startswith(("0", "3")):
        return "SZ"
    if code.startswith(("4", "8")):
        return "BJ"
    return "SZ"


async def _fetch_and_save_profile(symbol: str, name: str, spot_df=None) -> bool:
    try:
        if spot_df is None:
            spot_df = await asyncio.to_thread(fetch_all_stocks)

        row = spot_df[spot_df["代码"] == symbol]
        if row.empty:
            logger.warning("[download] %s not found in spot data", symbol)
            return False
        row = row.iloc[0]

        industry = "未知"
        try:
            info_df = await asyncio.to_thread(fetch_stock_info, symbol)
            info_map = dict(zip(info_df["item"], info_df["value"]))
            industry = str(info_map.get("行业", "未知"))
        except Exception:
            pass

        code = str(row["代码"])
        profile = {
            "symbol": code,
            "name": str(row["名称"]),
            "market": _detect_market(code),
            "industry": industry,
            "currentPrice": float(row.get("最新价", 0) or 0),
            "change": float(row.get("涨跌额", 0) or 0),
            "changePercent": float(row.get("涨跌幅", 0) or 0),
            "marketCap": float(row.get("总市值", 0) or 0),
            "pe": float(row.get("市盈率-动态", 0) or 0),
            "pb": float(row.get("市净率", 0) or 0),
            "dividendYield": 0.0,
            "turnoverRate": float(row.get("换手率", 0) or 0),
            "volume": float(row.get("成交量", 0) or 0),
            "updateTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "open": float(row.get("今开", 0) or 0),
            "high": float(row.get("最高", 0) or 0),
            "low": float(row.get("最低", 0) or 0),
            "previousClose": float(row.get("昨收", 0) or 0),
            "amplitude": float(row.get("振幅", 0) or 0),
            "turnoverAmount": float(row.get("成交额", 0) or 0),
            "freeFloatMarketCap": float(row.get("流通市值", 0) or 0),
            "change60d": float(row.get("60日涨跌幅", 0) or 0),
            "changeYtd": float(row.get("年初至今涨跌幅", 0) or 0),
            "volumeRatio": float(row.get("量比", 0) or 0),
        }
        data_store.save_stock_data(symbol, "profile", profile)
        return 1
    except Exception as e:
        logger.error("[download] profile %s failed: %s", symbol, e)
        return 0


async def _fetch_and_save_kline(symbol: str, period: str = "day") -> int:
    try:
        period_map = {"day": "daily", "week": "weekly", "month": "monthly"}
        ak_period = period_map.get(period, "daily")

        df = await asyncio.to_thread(fetch_stock_hist, symbol, ak_period, "", "", "qfq")
        closes = df["收盘"].tolist()

        def ma(n: int, idx: int):
            if idx < n - 1:
                return None
            return round(sum(closes[idx - n + 1: idx + 1]) / n, 2)

        result = []
        for i, (_, row) in enumerate(df.iterrows()):
            result.append({
                "date": str(row["日期"]),
                "open": float(row["开盘"]),
                "high": float(row["最高"]),
                "low": float(row["最低"]),
                "close": float(row["收盘"]),
                "volume": float(row["成交量"]),
                "ma5": ma(5, i),
                "ma10": ma(10, i),
                "ma20": ma(20, i),
                "ma60": ma(60, i),
            })

        data_store.save_stock_data(symbol, f"kline_{period}", result)
        return len(result)
    except Exception as e:
        logger.error("[download] kline_%s %s failed: %s", period, symbol, e)
        return 0


async def _fetch_and_save_financials(symbol: str) -> int:
    try:
        from services.stock_service import _assemble_financials

        profit_df, balance_df, cashflow_df = await asyncio.gather(
            asyncio.to_thread(fetch_financial_report, symbol, "profit"),
            asyncio.to_thread(fetch_financial_report, symbol, "balance"),
            asyncio.to_thread(fetch_financial_report, symbol, "cashflow"),
        )

        if profit_df is None:
            data_store.save_stock_data(symbol, "financials", [])
            return 0

        profit_df = profit_df[profit_df["报告日"].astype(str).str.endswith("1231")]
        if balance_df is not None:
            balance_df = balance_df[balance_df["报告日"].astype(str).str.endswith("1231")]
        if cashflow_df is not None:
            cashflow_df = cashflow_df[cashflow_df["报告日"].astype(str).str.endswith("1231")]

        results = _assemble_financials(profit_df, balance_df, cashflow_df)
        data_store.save_stock_data(symbol, "financials", [item.model_dump() for item in results])
        return len(results)
    except Exception as e:
        logger.error("[download] financials %s failed: %s", symbol, e)
        return 0


async def _fetch_and_save_news(symbol: str) -> int:
    try:
        df = await asyncio.to_thread(fetch_stock_news, symbol)
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

            results.append({
                "id": str(i),
                "title": title,
                "type": doc_type,
                "publishTime": pub_time,
                "source": source,
                "summary": content[:200] if content else title,
                "sentiment": sentiment,
                "risks": [],
                "url": url,
            })

        data_store.save_stock_data(symbol, "news", results)
        return len(results)
    except Exception as e:
        logger.error("[download] news %s failed: %s", symbol, e)
        return 0


async def _fetch_and_save_dividends(symbol: str) -> int:
    try:
        from models.stock import DividendRecord

        df = await asyncio.to_thread(fetch_dividend_data, symbol)
        if df is None or df.empty:
            data_store.save_stock_data(symbol, "dividends", [])
            return 0

        results = []
        for _, row in df.iterrows():
            report_date = str(row.get("报告日", ""))
            try:
                year = int(report_date[:4])
            except (ValueError, TypeError):
                continue
            results.append({
                "year": year,
                "dividendPerShare": float(row.get("派息", 0) or 0),
                "bonusShares": float(row.get("送股", 0) or 0),
                "reservePerShare": float(row.get("转增", 0) or 0),
                "exDate": str(row.get("除权除息日", "")),
                "recordDate": str(row.get("股权登记日", "")),
            })

        data_store.save_stock_data(symbol, "dividends", results)
        return len(results)
    except Exception as e:
        logger.error("[download] dividends %s failed: %s", symbol, e)
        return 0


async def _download_single(symbol: str, name: str, data_types: list[str], spot_df=None) -> dict[str, int]:
    """Download all requested data types for a single stock. Returns {data_type: row_count}."""
    stats: dict[str, int] = {}
    for dt in data_types:
        if dt == "profile":
            stats[dt] = await _fetch_and_save_profile(symbol, name, spot_df)
        elif dt == "kline_day":
            stats[dt] = await _fetch_and_save_kline(symbol, "day")
        elif dt == "kline_week":
            stats[dt] = await _fetch_and_save_kline(symbol, "week")
        elif dt == "kline_month":
            stats[dt] = await _fetch_and_save_kline(symbol, "month")
        elif dt == "financials":
            stats[dt] = await _fetch_and_save_financials(symbol)
        elif dt == "news":
            stats[dt] = await _fetch_and_save_news(symbol)
        elif dt == "dividends":
            stats[dt] = await _fetch_and_save_dividends(symbol)
    return stats


async def _run_download(symbols: list[dict], data_types: list[str], resume_from: str | None = None):
    global _stop_flag
    _stop_flag = False

    total = len(symbols)
    state = data_store.load_download_state() or {}
    completed = state.get("completed", 0) if resume_from else 0
    failed: list[str] = state.get("failed", []) if resume_from else []
    logs: list[str] = state.get("logs", []) if resume_from else []
    skipped = 0

    # If resuming, skip symbols until we pass the last completed one
    start_idx = 0
    if resume_from:
        for i, s in enumerate(symbols):
            if s["code"] == resume_from:
                start_idx = i + 1
                break

    # Load spot data once for all profile fetches
    spot_df = None
    if "profile" in data_types:
        try:
            spot_df = await asyncio.to_thread(fetch_all_stocks)
        except Exception as e:
            logger.error("[download] failed to load spot data: %s", e)

    logger.info("[download] starting: %d stocks, types=%s, resume_from=%s", total - start_idx, data_types, resume_from)
    _append_log(logs, f"开始下载 {total - start_idx} 只股票")

    def _save_state(status: str, last_symbol: str | None):
        data_store.save_download_state({
            "status": status,
            "total": total,
            "completed": completed,
            "failed": failed,
            "lastSymbol": last_symbol,
            "startedAt": state.get("startedAt", datetime.now().isoformat()),
            "updatedAt": datetime.now().isoformat(),
            "dataTypes": data_types,
            "logs": logs,
        })

    for i in range(start_idx, total):
        if _stop_flag:
            _save_state("paused", symbols[i - 1]["code"] if i > 0 else None)
            _append_log(logs, f"已暂停 ({completed}/{total})")
            logger.info("[download] paused at %s (%d/%d)", symbols[i]["code"], completed, total)
            return

        symbol = symbols[i]["code"]
        name = symbols[i]["name"]

        # Check if already has data (skip for resume)
        if not resume_from and data_store.has_stock_data(symbol, "profile"):
            skipped += 1
            completed += 1
            continue

        try:
            stats = await _download_single(symbol, name, data_types, spot_df)
            completed += 1
            # Build summary: "日K:6000 财务:20 新闻:50"
            parts = []
            label_map = {
                "kline_day": "日K", "kline_week": "周K", "kline_month": "月K",
                "financials": "财务", "news": "新闻", "dividends": "分红", "profile": "基本信息",
            }
            for dt, count in stats.items():
                if count > 0:
                    parts.append(f"{label_map.get(dt, dt)}:{count}")
            summary = ", ".join(parts) if parts else "无数据"
            _append_log(logs, f"{symbol} {name} — {summary} ✓")
            if completed % 50 == 0:
                logger.info("[download] progress: %d/%d (%.1f%%)", completed, total, completed / total * 100)
        except Exception as e:
            logger.error("[download] %s failed: %s", symbol, e)
            _append_log(logs, f"{symbol} {name} — 失败: {e}")
            if symbol not in failed:
                failed.append(symbol)

        # Save state every 10 stocks
        if completed % 10 == 0:
            _save_state("running", symbol)

        # Rate limit
        await asyncio.sleep(0.5)

    # Done
    _save_state("completed", symbols[-1]["code"] if symbols else None)
    _append_log(logs, f"下载完成 {completed}/{total}，跳过 {skipped}，失败 {len(failed)}")
    logger.info("[download] completed: %d/%d done, %d skipped, %d failed", completed, total, skipped, len(failed))


def get_download_status() -> dict:
    state = data_store.load_download_state()
    if state is None:
        return {
            "status": "idle",
            "total": 0,
            "completed": 0,
            "failed": [],
            "lastSymbol": None,
            "startedAt": None,
            "updatedAt": None,
            "dataTypes": [],
            "logs": [],
        }
    return state


async def start_download(data_types: list[str] | None = None) -> dict:
    global _download_task

    if _download_task and not _download_task.done():
        return {"status": "already_running", "message": "Download is already in progress"}

    if data_types is None:
        data_types = list(data_store.DATA_TYPES)

    stock_list = _load_stock_list()
    if not stock_list:
        return {"status": "error", "message": "No stock list found. Wait for prewarm to complete."}

    # Check for resume
    state = data_store.load_download_state()
    resume_from = None
    if state and state.get("status") in ("paused", "running"):
        resume_from = state.get("lastSymbol")
        logger.info("[download] resuming from %s", resume_from)

    data_store.save_download_state({
        "status": "running",
        "total": len(stock_list),
        "completed": 0,
        "failed": [],
        "lastSymbol": None,
        "startedAt": datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat(),
        "dataTypes": data_types,
        "logs": [],
    })

    _download_task = asyncio.create_task(_run_download(stock_list, data_types, resume_from))
    return {"status": "started", "total": len(stock_list), "resumeFrom": resume_from}


async def stop_download() -> dict:
    global _stop_flag
    _stop_flag = True
    return {"status": "stopping", "message": "Download will stop after current stock completes"}


async def refresh_single(symbol: str) -> dict:
    """Re-download all data for a single stock (force overwrite)."""
    stock_list = _load_stock_list()
    name = ""
    for s in stock_list:
        if s["code"] == symbol:
            name = s["name"]
            break

    data_types = list(data_store.DATA_TYPES)
    try:
        await _download_single(symbol, name, data_types)
        return {"status": "ok", "symbol": symbol, "message": f"Refreshed data for {symbol}"}
    except Exception as e:
        return {"status": "error", "symbol": symbol, "message": str(e)}


async def refresh_all_existing() -> dict:
    """Re-download data for all stocks that already have local data."""
    global _download_task

    if _download_task and not _download_task.done():
        return {"status": "already_running", "message": "Download is already in progress"}

    symbols = data_store.list_stock_symbols_with_data()
    if not symbols:
        return {"status": "error", "message": "No local data to refresh"}

    stock_list = _load_stock_list()
    stock_map = {s["code"]: s["name"] for s in stock_list}
    refresh_list = [{"code": s, "name": stock_map.get(s, "")} for s in symbols]

    data_store.save_download_state({
        "status": "running",
        "total": len(refresh_list),
        "completed": 0,
        "failed": [],
        "lastSymbol": None,
        "startedAt": datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat(),
        "dataTypes": list(data_store.DATA_TYPES),
        "logs": [],
    })

    _download_task = asyncio.create_task(_run_download(refresh_list, list(data_store.DATA_TYPES)))
    return {"status": "started", "total": len(refresh_list)}
