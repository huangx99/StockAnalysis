import asyncio
import json
import logging
import time
from functools import lru_cache
from datetime import datetime
from pathlib import Path

from services import data_store
from services.download_executor import MAX_DOWNLOAD_THREADS, STOCK_DOWNLOAD_CONCURRENCY, install_default_executor
from services.data_sources import get_registry, DataCapability
from cache.cache_manager import financials_cache, kline_cache, news_cache, profile_cache

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

_single_download_state: dict | None = None
_symbol_download_locks: dict[str, asyncio.Lock] = {}
_symbol_download_locks_guard = asyncio.Lock()
_single_download_semaphore = asyncio.Semaphore(max(1, STOCK_DOWNLOAD_CONCURRENCY))


async def _get_symbol_download_lock(symbol: str) -> asyncio.Lock:
    async with _symbol_download_locks_guard:
        lock = _symbol_download_locks.get(symbol)
        if lock is None:
            lock = asyncio.Lock()
            _symbol_download_locks[symbol] = lock
        return lock


async def _run_symbol_download(symbol: str, download):
    lock = await _get_symbol_download_lock(symbol)
    async with lock:
        async with _single_download_semaphore:
            return await download()


async def _try_run_symbol_download(symbol: str, download):
    lock = await _get_symbol_download_lock(symbol)
    if lock.locked():
        return None
    async with lock:
        async with _single_download_semaphore:
            return await download()


def get_missing_data_types(symbol: str) -> list[str]:
    return [data_type for data_type in PRIMARY_DATA_TYPES if not data_store.has_stock_data(symbol, data_type)]


def _invalidate_kline_cache(symbol: str, period: str) -> None:
    kline_cache.pop(f"kline:{symbol}:{period}", None)


def _invalidate_stock_caches(symbol: str) -> None:
    profile_cache.pop(f"profile:{symbol}", None)
    for period in ("day", "week", "month"):
        _invalidate_kline_cache(symbol, period)
    for key in list(financials_cache.keys()):
        if str(key).startswith(f"financials:{symbol}"):
            financials_cache.pop(key, None)
    for key in list(news_cache.keys()):
        if str(key).startswith(f"news:{symbol}"):
            news_cache.pop(key, None)


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


def _normalize_date_value(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text or text.lower() in {"none", "nan", "nat"}:
        return ""
    text = text.replace("/", "-")
    if "T" in text:
        text = text.replace("T", " ")
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    if len(text) >= 14 and text[:14].isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]} {text[8:10]}:{text[10:12]}:{text[12:14]}"
    return text[:19]


def _date_only(value) -> str:
    normalized = _normalize_date_value(value)
    return normalized[:10] if len(normalized) >= 10 else normalized


def _date_to_yyyymmdd(value: str | None, default: str = "20200101") -> str:
    date_text = _date_only(value)
    if len(date_text) == 10:
        return date_text.replace("-", "")
    return default


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except (TypeError, ValueError):
        return default


@lru_cache(maxsize=1)
def _trade_dates_until_today() -> set[str] | None:
    try:
        import akshare as ak

        df = ak.tool_trade_date_hist_sina()
        if df is None or df.empty:
            return None
        column = "trade_date" if "trade_date" in df.columns else df.columns[0]
        today = datetime.now().strftime("%Y-%m-%d")
        dates = set()
        for value in df[column].tolist():
            date_text = _date_only(value)
            if date_text and date_text <= today:
                dates.add(date_text)
        return dates or None
    except Exception as e:
        logger.warning("[download] trade calendar failed: %s", e)
        return None


def _is_trade_date(date_text: str) -> bool:
    trade_dates = _trade_dates_until_today()
    if trade_dates is not None:
        return date_text in trade_dates
    try:
        return datetime.strptime(date_text, "%Y-%m-%d").weekday() < 5
    except ValueError:
        return False


def _with_moving_averages(rows: list[dict]) -> list[dict]:
    rows = sorted(rows, key=lambda row: row.get("date") or "")
    closes = [_safe_float(row.get("close")) for row in rows]
    for idx, row in enumerate(rows):
        for window in (5, 10, 20, 60):
            key = f"ma{window}"
            if idx < window - 1:
                row[key] = None
            else:
                row[key] = round(sum(closes[idx - window + 1: idx + 1]) / window, 2)
    return rows


def _max_record_date(records: list[dict], date_getter) -> str:
    latest = ""
    for record in records:
        date_text = _normalize_date_value(date_getter(record))
        if date_text > latest:
            latest = date_text
    return latest


def _record_key(record: dict, key_fields: tuple[str, ...]) -> tuple:
    return tuple(_normalize_date_value(record.get(field)) if "date" in field.lower() or "time" in field.lower() else record.get(field) for field in key_fields)


def _merge_newer_records(
    existing: list[dict],
    fetched: list[dict],
    date_getter,
    key_fields: tuple[str, ...],
    *,
    descending: bool = True,
) -> tuple[list[dict], int]:
    latest = _max_record_date(existing, date_getter)
    seen = {_record_key(record, key_fields) for record in existing}
    new_records: list[dict] = []

    for record in fetched:
        record_date = _normalize_date_value(date_getter(record))
        if latest and record_date and record_date <= latest:
            continue
        key = _record_key(record, key_fields)
        if key in seen:
            continue
        seen.add(key)
        new_records.append(record)

    merged = existing + new_records
    merged.sort(key=lambda record: _normalize_date_value(date_getter(record)), reverse=descending)
    return merged, len(new_records)


def _load_list_data(symbol: str, data_type: str) -> list[dict]:
    local = data_store.load_stock_data(symbol, data_type)
    return local if isinstance(local, list) else []


def _save_date_diff_records(
    symbol: str,
    data_type: str,
    fetched: list[dict],
    date_getter,
    key_fields: tuple[str, ...],
    *,
    descending: bool = True,
) -> tuple[list[dict], int]:
    existing = _load_list_data(symbol, data_type)
    if not existing:
        merged = list(fetched)
        merged.sort(key=lambda record: _normalize_date_value(date_getter(record)), reverse=descending)
        data_store.save_stock_data(symbol, data_type, merged)
        return merged, len(merged)

    merged, new_count = _merge_newer_records(existing, fetched, date_getter, key_fields, descending=descending)
    if new_count:
        data_store.save_stock_data(symbol, data_type, merged)
    return merged, new_count


def _dividend_record_date(record: dict) -> str:
    return record.get("exDate") or record.get("recordDate") or f"{record.get('year', '')}-12-31"


async def _fetch_and_save_profile(symbol: str, name: str, spot_df=None) -> bool:
    try:
        registry = get_registry()

        if spot_df is None:
            spot_result = await registry.fetch(DataCapability.SPOT_QUOTE)
            if not spot_result.ok:
                logger.warning("[download] %s spot fetch failed: %s", symbol, spot_result.error)
                return False
            spot_df = spot_result.data

        row = spot_df[spot_df["代码"] == symbol]
        if row.empty:
            logger.warning("[download] %s not found in spot data", symbol)
            return False
        row = row.iloc[0]

        industry = "未知"
        try:
            info_result = await registry.fetch(DataCapability.STOCK_INFO, symbol=symbol)
            if info_result.ok:
                info_df = info_result.data
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

        # Try to enhance with Yahoo data (automatic via registry)
        yahoo_result = await registry.fetch(DataCapability.SPOT_QUOTE, symbol=symbol, preferred_source="yahoo")
        if yahoo_result.ok and isinstance(yahoo_result.data, dict):
            yahoo_fields = yahoo_result.data
            if _date_only(profile.get("updateTime")) <= _date_only(yahoo_fields.get("updateTime")):
                profile.update(yahoo_fields)

        data_store.save_stock_data(symbol, "profile", profile)
        return 1
    except Exception as e:
        logger.warning("[download] profile %s failed: %s", symbol, e)
        return 0


async def _fetch_and_save_kline(symbol: str, period: str = "day") -> int:
    try:
        registry = get_registry()
        period_map = {"day": "daily", "week": "weekly", "month": "monthly"}
        ak_period = period_map.get(period, "daily")

        # Incremental: if local data exists, only fetch from the last date.
        # If local history is missing or suspiciously short, keep a full-history
        # fallback path so a realtime single bar cannot replace the whole series.
        existing_rows = data_store.load_stock_data(symbol, f"kline_{period}")
        existing_rows = existing_rows if isinstance(existing_rows, list) else []
        needs_full_history = len(existing_rows) < 60
        last_date = data_store.get_last_kline_date(symbol, period)
        start_date = ""
        if last_date and not needs_full_history:
            start_date = last_date.replace("-", "")

        fetched_rows = []

        # Use registry with automatic failover (AKShare -> Yahoo)
        result = await registry.fetch(
            DataCapability.HISTORICAL_KLINE,
            symbol=symbol,
            period=ak_period,
            start_date=start_date,
            end_date="",
            adjust="qfq",
        )

        if result.ok and result.data is not None:
            df = result.data
            logger.info("[download] kline_%s %s fetched from %s", period, symbol, result.source_name)

            if result.source_name == "yahoo":
                # Yahoo returns pre-processed rows
                fetched_rows = df.to_dict("records") if hasattr(df, "to_dict") else df
            else:
                # AKShare returns raw DataFrame
                closes = df["收盘"].tolist()

                def ma(n: int, idx: int):
                    if idx < n - 1:
                        return None
                    return round(sum(closes[idx - n + 1: idx + 1]) / n, 2)

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

        if period == "day":
            realtime_row = _build_realtime_daily_kline_row(symbol, last_date)
            if realtime_row is not None:
                fetched_rows = [row for row in fetched_rows if row.get("date") != realtime_row["date"]]
                fetched_rows.append(realtime_row)

        if not fetched_rows:
            _invalidate_kline_cache(symbol, period)
            return 0

        if last_date:
            # Incremental merge: update overlapping current bar and append new dates.
            existing = data_store.load_stock_data(symbol, f"kline_{period}") or []
            merged_by_date = {str(row.get("date")): dict(row) for row in existing if row.get("date")}
            changed_count = 0
            for row in fetched_rows:
                row_date = str(row.get("date") or "")
                if not row_date:
                    continue
                if merged_by_date.get(row_date) != row:
                    merged_by_date[row_date] = row
                    changed_count += 1
            if not changed_count:
                _invalidate_kline_cache(symbol, period)
                return 0
            merged = [merged_by_date[date] for date in sorted(merged_by_date)]
            # Recalculate MAs after replacing the current bar or appending new rows.
            closes_all = [r["close"] for r in merged]
            for j in range(len(merged)):
                for n in (5, 10, 20, 60):
                    key = f"ma{n}"
                    if j < n - 1:
                        merged[j][key] = None
                    else:
                        merged[j][key] = round(sum(closes_all[j - n + 1: j + 1]) / n, 2)
            data_store.save_stock_data(symbol, f"kline_{period}", merged)
            _invalidate_kline_cache(symbol, period)
            return changed_count
        else:
            data_store.save_stock_data(symbol, f"kline_{period}", fetched_rows)
            _invalidate_kline_cache(symbol, period)
            return len(fetched_rows)
    except Exception as e:
        logger.error("[download] kline_%s %s failed: %s", period, symbol, e)
        return 0


def _build_realtime_daily_kline_row(symbol: str, last_date: str | None) -> dict | None:
    profile = data_store.load_stock_data(symbol, "profile")
    if not isinstance(profile, dict):
        return None

    profile_date = _date_only(profile.get("updateTime"))
    if not profile_date or (last_date and profile_date <= last_date):
        return None
    if not _is_trade_date(profile_date):
        return None

    current_price = _safe_float(profile.get("currentPrice"))
    open_price = _safe_float(profile.get("open"))
    high_price = _safe_float(profile.get("high"))
    low_price = _safe_float(profile.get("low"))
    previous_close = _safe_float(profile.get("previousClose"))
    volume = _safe_float(profile.get("volume"))
    if min(current_price, open_price, high_price, low_price) <= 0 or volume <= 0:
        return None

    if last_date:
        existing = data_store.load_stock_data(symbol, "kline_day") or []
        last_row = next((row for row in reversed(existing) if row.get("date") == last_date), None)
        last_close = _safe_float(last_row.get("close") if isinstance(last_row, dict) else None)
        tolerance = max(0.03, last_close * 0.002)
        if last_close > 0 and previous_close > 0 and abs(previous_close - last_close) > tolerance:
            logger.info(
                "[download] skip realtime kline %s: previousClose %.2f mismatches last close %.2f",
                symbol,
                previous_close,
                last_close,
            )
            return None

    return {
        "date": profile_date,
        "open": open_price,
        "high": max(high_price, open_price, current_price),
        "low": min(low_price, open_price, current_price),
        "close": current_price,
        "volume": volume,
        "ma5": None,
        "ma10": None,
        "ma20": None,
        "ma60": None,
    }


async def _fetch_and_save_financials(symbol: str) -> int:
    try:
        from models.stock import FinancialPeriodMetrics
        from services.stock_service import (
            _annual_legacy_from_periods,
            _assemble_financial_periods,
            _build_financial_summary,
            _records_from_df,
        )

        registry = get_registry()
        income_result, balance_result, cashflow_result, indicator_result = await asyncio.gather(
            registry.fetch(DataCapability.FINANCIAL_REPORT, symbol=symbol, report_type="income"),
            registry.fetch(DataCapability.FINANCIAL_REPORT, symbol=symbol, report_type="balance"),
            registry.fetch(DataCapability.FINANCIAL_REPORT, symbol=symbol, report_type="cashflow"),
            registry.fetch(DataCapability.FINANCIAL_INDICATORS, symbol=symbol, start_year="2016"),
        )

        income_df = income_result.data if income_result.ok else None
        balance_df = balance_result.data if balance_result.ok else None
        cashflow_df = cashflow_result.data if cashflow_result.ok else None
        indicator_df = indicator_result.data if indicator_result.ok else None

        if income_df is not None:
            _save_date_diff_records(
                symbol,
                "financial_income_raw",
                _records_from_df(income_df),
                lambda record: record.get("REPORT_DATE"),
                ("REPORT_DATE",),
            )
            _save_date_diff_records(
                symbol,
                "financial_balance_raw",
                _records_from_df(balance_df),
                lambda record: record.get("REPORT_DATE"),
                ("REPORT_DATE",),
            )
            _save_date_diff_records(
                symbol,
                "financial_cashflow_raw",
                _records_from_df(cashflow_df),
                lambda record: record.get("REPORT_DATE"),
                ("REPORT_DATE",),
            )
            _save_date_diff_records(
                symbol,
                "financial_indicator_raw",
                _records_from_df(indicator_df),
                lambda record: record.get("日期"),
                ("日期",),
            )

            fetched_periods = [item.model_dump() for item in _assemble_financial_periods(symbol, income_df, balance_df, cashflow_df, indicator_df)]
            merged_periods, new_count = _save_date_diff_records(
                symbol,
                "financial_periods",
                fetched_periods,
                lambda record: record.get("reportDate"),
                ("reportDate",),
            )
            if new_count or not data_store.has_stock_data(symbol, "financial_summary"):
                period_models = [FinancialPeriodMetrics(**item) for item in merged_periods]
                summary = _build_financial_summary(symbol, period_models)
                data_store.save_stock_data(symbol, "financial_summary", summary.model_dump())
                data_store.save_stock_data(symbol, "financials", [item.model_dump() for item in _annual_legacy_from_periods(period_models)])
            return new_count

        from services.stock_service import _assemble_financials

        # Fallback to legacy Sina source
        profit_result, balance_result, cashflow_result = await asyncio.gather(
            registry.fetch(DataCapability.FINANCIAL_REPORT, symbol=symbol, report_type="profit", use_em=False),
            registry.fetch(DataCapability.FINANCIAL_REPORT, symbol=symbol, report_type="balance", use_em=False),
            registry.fetch(DataCapability.FINANCIAL_REPORT, symbol=symbol, report_type="cashflow", use_em=False),
        )

        profit_df = profit_result.data if profit_result.ok else None
        balance_df = balance_result.data if balance_result.ok else None
        cashflow_df = cashflow_result.data if cashflow_result.ok else None

        if profit_df is None:
            if not data_store.has_stock_data(symbol, "financials"):
                data_store.save_stock_data(symbol, "financials", [])
            return 0

        profit_df = profit_df[profit_df["报告日"].astype(str).str.endswith("1231")]
        if balance_df is not None:
            balance_df = balance_df[balance_df["报告日"].astype(str).str.endswith("1231")]
        if cashflow_df is not None:
            cashflow_df = cashflow_df[cashflow_df["报告日"].astype(str).str.endswith("1231")]

        results = [item.model_dump() for item in _assemble_financials(profit_df, balance_df, cashflow_df)]
        _, new_count = _save_date_diff_records(
            symbol,
            "financials",
            results,
            lambda record: f"{record.get('year', '')}-12-31",
            ("year",),
        )
        return new_count
    except Exception as e:
        logger.error("[download] financials %s failed: %s", symbol, e)
        return 0


async def _fetch_and_save_news(symbol: str) -> int:
    existing = _load_list_data(symbol, "news")
    last_time = _max_record_date(existing, lambda record: record.get("publishTime"))
    try:
        result = await get_registry().fetch(DataCapability.NEWS, symbol=symbol, since_time=last_time if existing else None)
        if not result.ok:
            logger.warning("[download] news %s failed: %s", symbol, result.error)
            return 0
        df = result.data
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
                "id": f"news_{len(existing) + i}",
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

        _, new_count = _save_date_diff_records(
            symbol,
            "news",
            results,
            lambda record: record.get("publishTime"),
            ("title", "publishTime"),
        )
        return new_count
    except Exception as e:
        message = str(e)
        if "returned empty" in message and not existing:
            data_store.save_stock_data(symbol, "news", [])
            logger.info("[download] news %s has no remote data; saved empty list", symbol)
            return 0
        if "returned empty" in message:
            logger.info("[download] news %s has no date-diff updates", symbol)
            return 0
        logger.error("[download] news %s failed: %s", symbol, e)
        return 0


async def _fetch_and_save_dividends(symbol: str) -> int:
    try:
        result = await get_registry().fetch(DataCapability.DIVIDEND, symbol=symbol)
        if not result.ok or result.data is None:
            if not data_store.has_stock_data(symbol, "dividends"):
                data_store.save_stock_data(symbol, "dividends", [])
            return 0
        df = result.data
        if df.empty:
            if not data_store.has_stock_data(symbol, "dividends"):
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

        _, new_count = _save_date_diff_records(
            symbol,
            "dividends",
            results,
            _dividend_record_date,
            ("year", "exDate", "recordDate"),
        )
        return new_count
    except Exception as e:
        logger.error("[download] dividends %s failed: %s", symbol, e)
        return 0


async def _fetch_and_save_notices(symbol: str) -> int:
    existing = _load_list_data(symbol, "notices")
    last_time = _max_record_date(existing, lambda record: record.get("publishTime"))
    try:
        start_date = _date_to_yyyymmdd(last_time) if existing else None
        result = await get_registry().fetch(DataCapability.NOTICES, symbol=symbol, start_date=start_date)
        if not result.ok or result.data is None:
            if not existing:
                data_store.save_stock_data(symbol, "notices", [])
            return 0
        df = result.data
        if df.empty:
            if not existing:
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

        _, new_count = _save_date_diff_records(
            symbol,
            "notices",
            results,
            lambda record: record.get("publishTime"),
            ("title", "publishTime"),
        )
        return new_count
    except Exception as e:
        logger.error("[download] notices %s failed: %s", symbol, e)
        return 0


async def _fetch_and_save_reports(symbol: str) -> int:
    try:
        result = await get_registry().fetch(DataCapability.RESEARCH_REPORTS, symbol=symbol)
        if not result.ok or result.data is None:
            if not data_store.has_stock_data(symbol, "reports"):
                data_store.save_stock_data(symbol, "reports", [])
            return 0
        df = result.data
        if df.empty:
            if not data_store.has_stock_data(symbol, "reports"):
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

        _, new_count = _save_date_diff_records(
            symbol,
            "reports",
            results,
            lambda record: record.get("publishTime"),
            ("title", "publishTime", "institution"),
        )
        return new_count
    except Exception as e:
        logger.error("[download] reports %s failed: %s", symbol, e)
        return 0


async def _download_single(symbol: str, name: str, data_types: list[str], spot_df=None) -> dict[str, int]:
    """Download all requested data types for a single stock. Returns {data_type: row_count}."""
    return await _run_symbol_download(
        symbol,
        lambda: _download_single_unlocked(symbol, name, data_types, spot_df),
    )


async def _download_single_unlocked(symbol: str, name: str, data_types: list[str], spot_df=None) -> dict[str, int]:
    """Download all requested data types for a single stock without acquiring locks."""
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
        elif dt == "notices":
            stats[dt] = await _fetch_and_save_notices(symbol)
        elif dt == "reports":
            stats[dt] = await _fetch_and_save_reports(symbol)
    return stats


async def _download_single_with_progress(symbol: str, name: str, data_types: list[str], spot_df=None) -> dict[str, int]:
    return await _run_symbol_download(
        symbol,
        lambda: _download_single_with_progress_unlocked(symbol, name, data_types, spot_df),
    )


async def _download_single_with_progress_unlocked(symbol: str, name: str, data_types: list[str], spot_df=None) -> dict[str, int]:
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
            _append_log(logs, f"{label}: {count} 条 ✓" if count > 0 else f"{label}: 无新增")

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


async def _run_download(symbols: list[dict], data_types: list[str], resume_from: str | None = None):
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
            spot_result = await get_registry().fetch(DataCapability.SPOT_QUOTE)
            if spot_result.ok:
                spot_df = spot_result.data
            else:
                logger.error("[download] failed to load spot data: %s", spot_result.error)
        except Exception as e:
            logger.error("[download] failed to load spot data: %s", e)

    concurrency = min(STOCK_DOWNLOAD_CONCURRENCY, max(1, len(pending_symbols))) if pending_symbols else 1
    logger.info(
        "[download] starting concurrent date-diff update: %d pending/%d stocks, concurrency=%d, threads=%d, types=%s, resume_from=%s",
        len(pending_symbols), total, concurrency, MAX_DOWNLOAD_THREADS, data_types, resume_from,
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
                stats = await _download_single(symbol, name, data_types, spot_df)
                parts = [f"{DATA_TYPE_LABELS.get(data_type, data_type)}:{count}" for data_type, count in stats.items() if count > 0]
                summary = ", ".join(parts) if parts else "无新增"
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

    _download_task = asyncio.create_task(_run_download(stock_list, data_types, resume_from))
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
        stats = await _try_run_symbol_download(
            symbol,
            lambda: _download_single_unlocked(symbol, name, data_types),
        )
        if stats is None:
            return {"status": "already_running", "symbol": symbol, "message": f"{symbol} 正在刷新中，请稍后查看"}
        _invalidate_stock_caches(symbol)
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
        stats = await _try_run_symbol_download(
            symbol,
            lambda: _download_single_unlocked(symbol, name, missing_data_types),
        )
        if stats is None:
            return {
                "status": "already_running",
                "symbol": symbol,
                "missingDataTypes": missing_data_types,
                "message": f"{symbol} 正在刷新中，请稍后查看",
            }
        _invalidate_stock_caches(symbol)
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
