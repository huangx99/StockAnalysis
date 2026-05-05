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
    fetch_financial_report_em,
    fetch_financial_indicators,
    fetch_dividend_data,
    fetch_stock_notices,
    fetch_stock_reports,
)
from services import data_store
from services.download_executor import MAX_DOWNLOAD_THREADS, STOCK_DOWNLOAD_CONCURRENCY, install_default_executor

logger = logging.getLogger(__name__)

_download_task: asyncio.Task | None = None
_stop_flag = False
_MAX_LOGS = 500

DATA_TYPE_LABELS = {
    "profile": "基本信息",
    "kline_day": "日K",
    "kline_week": "周K",
    "kline_month": "月K",
    "financials": "财务",
    "news": "新闻",
    "dividends": "分红",
    "notices": "公告",
    "reports": "研报",
}
PRIMARY_DATA_TYPES = tuple(DATA_TYPE_LABELS.keys())

SKIP_EXISTING_DATA_TYPES = {"financials", "news", "dividends", "notices", "reports"}

_single_download_state: dict | None = None


def _stored_count(symbol: str, data_type: str) -> int:
    local = data_store.load_stock_data(symbol, data_type)
    if isinstance(local, list):
        return len(local)
    if isinstance(local, dict):
        return 1
    return 0


def _has_stored_data(symbol: str, data_type: str) -> bool:
    return data_store.has_stock_data(symbol, data_type)


def _has_financial_bundle(symbol: str) -> bool:
    return _has_stored_data(symbol, "financials") and _has_stored_data(symbol, "financial_periods")


def _should_skip_existing(symbol: str, data_type: str, skip_existing: bool) -> bool:
    return skip_existing and data_type in SKIP_EXISTING_DATA_TYPES and _has_stored_data(symbol, data_type)


def get_missing_data_types(symbol: str) -> list[str]:
    return [data_type for data_type in PRIMARY_DATA_TYPES if not data_store.has_stock_data(symbol, data_type)]


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

        # Incremental: if local data exists, only fetch from the last date
        last_date = data_store.get_last_kline_date(symbol, period)
        start_date = ""
        if last_date:
            start_date = last_date.replace("-", "")

        df = await asyncio.to_thread(fetch_stock_hist, symbol, ak_period, start_date, "", "qfq")
        if df is None or df.empty:
            return 0

        closes = df["收盘"].tolist()

        def ma(n: int, idx: int):
            if idx < n - 1:
                return None
            return round(sum(closes[idx - n + 1: idx + 1]) / n, 2)

        fetched_rows = []
        for i, (_, row) in enumerate(df.iterrows()):
            fetched_rows.append({
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

        if last_date and fetched_rows:
            # Incremental merge: keep existing, append only truly new dates
            existing = data_store.load_stock_data(symbol, f"kline_{period}") or []
            existing_dates = {r["date"] for r in existing}
            truly_new = [r for r in fetched_rows if r["date"] not in existing_dates]
            if not truly_new:
                # Already up to date
                return len(existing)
            merged = existing + truly_new
            # Recalculate MAs for the last 60 rows (boundary may shift)
            closes_all = [r["close"] for r in merged]
            for j in range(max(0, len(merged) - 60), len(merged)):
                for n in (5, 10, 20, 60):
                    key = f"ma{n}"
                    if j < n - 1:
                        merged[j][key] = None
                    else:
                        merged[j][key] = round(sum(closes_all[j - n + 1: j + 1]) / n, 2)
            data_store.save_stock_data(symbol, f"kline_{period}", merged)
            return len(merged)
        else:
            data_store.save_stock_data(symbol, f"kline_{period}", fetched_rows)
            return len(fetched_rows)
    except Exception as e:
        logger.error("[download] kline_%s %s failed: %s", period, symbol, e)
        return 0


async def _fetch_and_save_financials(symbol: str) -> int:
    try:
        from services.stock_service import (
            _annual_legacy_from_periods,
            _assemble_financial_periods,
            _build_financial_summary,
            _records_from_df,
        )

        income_df, balance_df, cashflow_df, indicator_df = await asyncio.gather(
            asyncio.to_thread(fetch_financial_report_em, symbol, "income"),
            asyncio.to_thread(fetch_financial_report_em, symbol, "balance"),
            asyncio.to_thread(fetch_financial_report_em, symbol, "cashflow"),
            asyncio.to_thread(fetch_financial_indicators, symbol, "2016"),
        )

        if income_df is not None:
            data_store.save_stock_data(symbol, "financial_income_raw", _records_from_df(income_df))
            data_store.save_stock_data(symbol, "financial_balance_raw", _records_from_df(balance_df))
            data_store.save_stock_data(symbol, "financial_cashflow_raw", _records_from_df(cashflow_df))
            data_store.save_stock_data(symbol, "financial_indicator_raw", _records_from_df(indicator_df))
            periods = _assemble_financial_periods(symbol, income_df, balance_df, cashflow_df, indicator_df)
            summary = _build_financial_summary(symbol, periods)
            data_store.save_stock_data(symbol, "financial_periods", [item.model_dump() for item in periods])
            data_store.save_stock_data(symbol, "financial_summary", summary.model_dump())
            data_store.save_stock_data(symbol, "financials", [item.model_dump() for item in _annual_legacy_from_periods(periods)])
            return len(periods)

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
                "id": f"news_{i}",
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

        data_store.save_stock_data(symbol, "news", results)
        return len(results)
    except Exception as e:
        message = str(e)
        if "returned empty" in message:
            data_store.save_stock_data(symbol, "news", [])
            logger.info("[download] news %s has no remote data; saved empty list", symbol)
            return 0
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


async def _fetch_and_save_notices(symbol: str) -> int:
    try:
        df = await asyncio.to_thread(fetch_stock_notices, symbol)
        if df is None or df.empty:
            data_store.save_stock_data(symbol, "notices", [])
            return 0

        results = []
        for _, row in df.iterrows():
            url = str(row.get("公告链接", "")) or None
            if url:
                if " " in url:
                    url = url.replace(" ", "%20")
                if url.startswith("http://"):
                    url = url.replace("http://", "https://", 1)
            results.append({
                "title": str(row.get("公告标题", "")),
                "publishTime": str(row.get("公告时间", "")),
                "url": url,
                "code": str(row.get("代码", symbol)),
                "name": str(row.get("简称", "")),
            })
        results.sort(key=lambda x: x["publishTime"], reverse=True)
        data_store.save_stock_data(symbol, "notices", results)
        return len(results)
    except Exception as e:
        logger.error("[download] notices %s failed: %s", symbol, e)
        return 0


async def _fetch_and_save_reports(symbol: str) -> int:
    try:
        df = await asyncio.to_thread(fetch_stock_reports, symbol)
        if df is None or df.empty:
            data_store.save_stock_data(symbol, "reports", [])
            return 0

        results = []
        for _, row in df.iterrows():
            url = str(row.get("报告PDF链接", "")) or None
            if url:
                if " " in url:
                    url = url.replace(" ", "%20")
                if url.startswith("http://"):
                    url = url.replace("http://", "https://", 1)
            results.append({
                "title": str(row.get("报告名称", "")),
                "publishTime": str(row.get("日期", "")),
                "url": url,
                "code": str(row.get("股票代码", symbol)),
                "name": str(row.get("股票简称", "")),
                "rating": str(row.get("东财评级", "")),
                "institution": str(row.get("机构", "")),
                "industry": str(row.get("行业", "")),
            })
        results.sort(key=lambda x: x["publishTime"], reverse=True)
        data_store.save_stock_data(symbol, "reports", results)
        return len(results)
    except Exception as e:
        logger.error("[download] reports %s failed: %s", symbol, e)
        return 0


async def _download_single(symbol: str, name: str, data_types: list[str], spot_df=None, skip_existing: bool = False) -> dict[str, int]:
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
            if skip_existing and _has_financial_bundle(symbol):
                stats[dt] = _stored_count(symbol, "financial_periods") or _stored_count(symbol, "financials")
            else:
                stats[dt] = await _fetch_and_save_financials(symbol)
        elif dt == "news":
            if _should_skip_existing(symbol, dt, skip_existing):
                stats[dt] = _stored_count(symbol, dt)
            else:
                stats[dt] = await _fetch_and_save_news(symbol)
        elif dt == "dividends":
            if _should_skip_existing(symbol, dt, skip_existing):
                stats[dt] = _stored_count(symbol, dt)
            else:
                stats[dt] = await _fetch_and_save_dividends(symbol)
        elif dt == "notices":
            if _should_skip_existing(symbol, dt, skip_existing):
                stats[dt] = _stored_count(symbol, dt)
            else:
                stats[dt] = await _fetch_and_save_notices(symbol)
        elif dt == "reports":
            if _should_skip_existing(symbol, dt, skip_existing):
                stats[dt] = _stored_count(symbol, dt)
            else:
                stats[dt] = await _fetch_and_save_reports(symbol)
    return stats


async def _download_single_with_progress(symbol: str, name: str, data_types: list[str], spot_df=None) -> dict[str, int]:
    global _single_download_state
    logs: list[str] = []
    _append_log(logs, f"开始下载 {symbol} {name}")

    _single_download_state = {
        "status": "running",
        "symbol": symbol,
        "name": name,
        "dataTypes": data_types,
        "completedTypes": [],
        "currentIndex": 0,
        "logs": logs,
        "startedAt": datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat(),
    }

    stats: dict[str, int] = {}
    try:
        for i, dt in enumerate(data_types):
            _single_download_state["currentIndex"] = i
            _single_download_state["updatedAt"] = datetime.now().isoformat()

            if dt == "profile":
                count = await _fetch_and_save_profile(symbol, name, spot_df)
            elif dt == "kline_day":
                count = await _fetch_and_save_kline(symbol, "day")
            elif dt == "kline_week":
                count = await _fetch_and_save_kline(symbol, "week")
            elif dt == "kline_month":
                count = await _fetch_and_save_kline(symbol, "month")
            elif dt == "financials":
                count = await _fetch_and_save_financials(symbol)
            elif dt == "news":
                count = await _fetch_and_save_news(symbol)
            elif dt == "dividends":
                count = await _fetch_and_save_dividends(symbol)
            elif dt == "notices":
                count = await _fetch_and_save_notices(symbol)
            elif dt == "reports":
                count = await _fetch_and_save_reports(symbol)
            else:
                count = 0

            stats[dt] = count
            _single_download_state["completedTypes"].append({"type": dt, "count": count})
            label = DATA_TYPE_LABELS.get(dt, dt)
            _append_log(logs, f"{label}: {count} 条 ✓" if count > 0 else f"{label}: 无数据")

        _single_download_state["status"] = "completed"
        _single_download_state["updatedAt"] = datetime.now().isoformat()
    except Exception as e:
        _single_download_state["status"] = "error"
        _single_download_state["updatedAt"] = datetime.now().isoformat()
        _append_log(logs, f"错误: {e}")
        raise
    finally:
        # Clear state after a short delay so frontend can poll the final status
        await asyncio.sleep(2)
        _single_download_state = None

    return stats


def get_single_download_status() -> dict:
    if _single_download_state is None:
        return {"status": "idle"}
    return _single_download_state


async def _run_download(symbols: list[dict], data_types: list[str], resume_from: str | None = None, skip_existing: bool = False):
    global _stop_flag
    _stop_flag = False
    install_default_executor()

    total = len(symbols)
    state = data_store.load_download_state() or {}
    saved_completed_symbols = set(state.get("completedSymbols") or []) if resume_from else set()
    completed = len(saved_completed_symbols) if saved_completed_symbols else (state.get("completed", 0) if resume_from else 0)
    failed: list[str] = state.get("failed", []) if resume_from else []
    logs: list[str] = state.get("logs", []) if resume_from else []
    running_symbols: set[str] = set()
    last_completed_symbol: str | None = state.get("lastSymbol") if resume_from else None

    start_idx = 0
    if resume_from and not saved_completed_symbols:
        for i, stock in enumerate(symbols):
            if stock["code"] == resume_from:
                start_idx = i + 1
                break

    pending_symbols = [stock for stock in symbols[start_idx:] if stock["code"] not in saved_completed_symbols]

    spot_df = None
    if "profile" in data_types:
        try:
            spot_df = await asyncio.to_thread(fetch_all_stocks)
        except Exception as e:
            logger.error("[download] failed to load spot data: %s", e)

    concurrency = min(STOCK_DOWNLOAD_CONCURRENCY, max(1, len(pending_symbols))) if pending_symbols else 1
    logger.info(
        "[download] starting concurrent: %d pending/%d stocks, concurrency=%d, threads=%d, types=%s, resume_from=%s, skip_existing=%s",
        len(pending_symbols), total, concurrency, MAX_DOWNLOAD_THREADS, data_types, resume_from, skip_existing,
    )
    _append_log(logs, f"开始并发下载 {len(pending_symbols)} 只股票，并发 {concurrency}，线程上限 {MAX_DOWNLOAD_THREADS}")

    state_lock = asyncio.Lock()
    queue: asyncio.Queue[dict] = asyncio.Queue()
    for stock in pending_symbols:
        queue.put_nowait(stock)

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
            "concurrency": concurrency,
            "maxThreads": MAX_DOWNLOAD_THREADS,
            "runningSymbols": sorted(running_symbols),
            "queued": queue.qsize(),
            "completedSymbols": sorted(saved_completed_symbols),
        })

    async def _finish_paused() -> None:
        async with state_lock:
            _append_log(logs, f"已暂停 ({completed}/{total})，剩余 {queue.qsize()} 只")
            _save_state("paused", last_completed_symbol)

    async def worker(worker_id: int) -> None:
        nonlocal completed, last_completed_symbol
        while not _stop_flag:
            try:
                stock = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            symbol = stock["code"]
            name = stock.get("name", "")
            async with state_lock:
                running_symbols.add(symbol)
                _save_state("running", last_completed_symbol)
            try:
                has_existing = data_store.has_stock_data(symbol, "profile")
                stats = await _download_single(symbol, name, data_types, spot_df, skip_existing=skip_existing)
                parts = [f"{DATA_TYPE_LABELS.get(data_type, data_type)}:{count}" for data_type, count in stats.items() if count > 0]
                summary = ", ".join(parts) if parts else "无数据"
                tag = "更新" if has_existing else "下载"
                async with state_lock:
                    completed += 1
                    saved_completed_symbols.add(symbol)
                    last_completed_symbol = symbol
                    _append_log(logs, f"[{completed}/{total}] W{worker_id} {symbol} {name} — {tag} {summary} ✓")
                    if completed % 50 == 0:
                        logger.info("[download] progress: %d/%d (%.1f%%)", completed, total, completed / total * 100)
            except Exception as e:
                logger.error("[download] %s failed: %s", symbol, e)
                async with state_lock:
                    completed += 1
                    saved_completed_symbols.add(symbol)
                    last_completed_symbol = symbol
                    _append_log(logs, f"[{completed}/{total}] W{worker_id} {symbol} {name} — 失败: {e}")
                    if symbol not in failed:
                        failed.append(symbol)
            finally:
                async with state_lock:
                    running_symbols.discard(symbol)
                    _save_state("running", last_completed_symbol)
                queue.task_done()
                await asyncio.sleep(0.1)

    if not pending_symbols:
        _append_log(logs, f"全部完成 {completed}/{total}，失败 {len(failed)}")
        _save_state("completed" if not failed else "error", last_completed_symbol)
        return

    workers = [asyncio.create_task(worker(index + 1)) for index in range(concurrency)]
    await asyncio.gather(*workers)

    if _stop_flag:
        await _finish_paused()
        logger.info("[download] paused: %d/%d", completed, total)
        return

    _append_log(logs, f"全部完成 {completed}/{total}，失败 {len(failed)}")
    _save_state("completed" if not failed else "error", last_completed_symbol)
    logger.info("[download] completed: %d/%d, %d failed", completed, total, len(failed))


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
    state.setdefault("logs", [])
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

    resumed = bool(resume_from)

    data_store.save_download_state({
        "status": "running",
        "total": len(stock_list),
        "completed": state.get("completed", 0) if resumed else 0,
        "failed": state.get("failed", []) if resumed else [],
        "lastSymbol": resume_from if resumed else None,
        "startedAt": state.get("startedAt", datetime.now().isoformat()) if resumed else datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat(),
        "dataTypes": data_types,
        "logs": state.get("logs", []) if resumed else [],
    })

    _download_task = asyncio.create_task(_run_download(stock_list, data_types, resume_from, skip_existing=True))
    return {"status": "started", "total": len(stock_list), "resumeFrom": resume_from}


async def stop_download() -> dict:
    global _stop_flag
    _stop_flag = True
    return {"status": "stopping", "message": "Download will stop after current stock completes"}


def _get_stock_name(symbol: str) -> str:
    stock_list = _load_stock_list()
    for stock in stock_list:
        if stock["code"] == symbol:
            return stock["name"]
    return ""


async def refresh_single(symbol: str) -> dict:
    """Re-download all data for a single stock (force overwrite)."""
    name = _get_stock_name(symbol)
    data_types = list(data_store.DATA_TYPES)
    try:
        await _download_single(symbol, name, data_types)
        return {"status": "ok", "symbol": symbol, "message": f"Refreshed data for {symbol}"}
    except Exception as e:
        return {"status": "error", "symbol": symbol, "message": str(e)}


async def refresh_missing(symbol: str) -> dict:
    """Download only missing primary local data types for a single stock."""
    name = _get_stock_name(symbol)
    missing_data_types = get_missing_data_types(symbol)
    if not missing_data_types:
        return {
            "status": "ok",
            "symbol": symbol,
            "missingDataTypes": [],
            "stats": {},
            "message": f"{symbol} has no missing local data",
        }

    try:
        stats = await _download_single(symbol, name, missing_data_types)
        still_missing = get_missing_data_types(symbol)
        fixed_data_types = [data_type for data_type in missing_data_types if data_type not in still_missing]
        status = "ok" if not still_missing else "partial"
        message = (
            f"Downloaded missing data for {symbol}"
            if not still_missing
            else f"Only fixed {len(fixed_data_types)}/{len(missing_data_types)} missing data types for {symbol}"
        )
        return {
            "status": status,
            "symbol": symbol,
            "missingDataTypes": missing_data_types,
            "fixedDataTypes": fixed_data_types,
            "stillMissingDataTypes": still_missing,
            "stats": stats,
            "message": message,
        }
    except Exception as e:
        return {"status": "error", "symbol": symbol, "missingDataTypes": missing_data_types, "message": str(e)}


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
