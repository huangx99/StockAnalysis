import asyncio
import logging
import math
from datetime import datetime, timedelta
from typing import Any

import akshare as ak
import pandas as pd

from adapters.akshare_adapter import fetch_all_stocks
from services import market_data_store
from services.download_executor import MAX_DOWNLOAD_THREADS, MARKET_DATE_CONCURRENCY, install_default_executor

logger = logging.getLogger(__name__)

_market_download_task: asyncio.Task | None = None
_pause_requested = False
_cancel_requested = False
_MAX_LOGS = 200

DATA_TYPE_LABELS = {
    "overview": "市场概览",
    "market_indices": "核心指数",
    "breadth": "市场宽度",
    "style_rotation": "风格轮动",
    "north_money": "北向资金",
    "sector_rank": "行业涨幅",
    "sector_fund_flow": "行业资金流",
    "limit_up_pool": "涨停池",
    "limit_down_pool": "跌停池",
    "sentiment": "情绪指标",
    "quality_report": "质量报告",
}

INDEX_SYMBOLS = [
    {"symbol": "sh000001", "name": "上证指数", "group": "核心指数"},
    {"symbol": "sz399001", "name": "深证成指", "group": "核心指数"},
    {"symbol": "sz399006", "name": "创业板指", "group": "核心指数"},
    {"symbol": "sh000688", "name": "科创50", "group": "核心指数"},
    {"symbol": "sh000300", "name": "沪深300", "group": "规模指数"},
    {"symbol": "sh000905", "name": "中证500", "group": "规模指数"},
    {"symbol": "sh000852", "name": "中证1000", "group": "规模指数"},
    {"symbol": "sh000015", "name": "红利指数", "group": "风格指数"},
]

STYLE_DEFINITIONS = [
    {"name": "大盘蓝筹", "symbol": "sh000300", "indexName": "沪深300"},
    {"name": "中盘成长", "symbol": "sh000905", "indexName": "中证500"},
    {"name": "小盘弹性", "symbol": "sh000852", "indexName": "中证1000"},
    {"name": "创业成长", "symbol": "sz399006", "indexName": "创业板指"},
    {"name": "硬科技", "symbol": "sh000688", "indexName": "科创50"},
    {"name": "高股息", "symbol": "sh000015", "indexName": "红利指数"},
]


def _append_log(logs: list[str], msg: str) -> None:
    entry = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    logs.append(entry)
    if len(logs) > _MAX_LOGS:
        del logs[:len(logs) - _MAX_LOGS]


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
        if math.isnan(result) or math.isinf(result):
            return default
        return result
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _records_from_df(df: pd.DataFrame | None) -> list[dict]:
    if df is None or df.empty:
        return []
    clean = df.where(pd.notnull(df), None)
    return clean.to_dict(orient="records")


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _ak_date(trade_date: str) -> str:
    return trade_date.replace("-", "")


def _normalize_date(value: Any) -> str:
    if value is None or value == "":
        return ""
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        text = str(value)
        if len(text) == 8 and text.isdigit():
            return f"{text[:4]}-{text[4:6]}-{text[6:]}"
        return text[:10]
    return parsed.strftime("%Y-%m-%d")


def _source_meta(
    trade_date: str,
    data_type: str,
    provider: str,
    api: str,
    source_date: str = "",
    *,
    historical: bool = True,
    status: str = "ok",
    warning: str = "",
) -> dict:
    return {
        "requestedTradeDate": trade_date,
        "sourceTradeDate": source_date or trade_date,
        "fetchedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "provider": provider,
        "api": api,
        "dataType": data_type,
        "historicalReplayable": historical,
        "status": status,
        "warning": warning,
    }


def _trade_calendar_df() -> pd.DataFrame | None:
    try:
        return ak.tool_trade_date_hist_sina()
    except Exception as e:
        logger.warning("[market_download] trade calendar failed: %s", e)
        return None


def _trade_dates_from_calendar(start_date: str, end_date: str) -> list[str]:
    calendar_df = _trade_calendar_df()
    if calendar_df is None or calendar_df.empty:
        dates: list[str] = []
        current = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
        while current <= end:
            if current.weekday() < 5:
                dates.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)
        return dates
    date_column = "trade_date" if "trade_date" in calendar_df.columns else calendar_df.columns[0]
    clean = calendar_df.copy()
    clean[date_column] = pd.to_datetime(clean[date_column], errors="coerce")
    dates = clean[
        (clean[date_column] >= pd.to_datetime(start_date))
        & (clean[date_column] <= pd.to_datetime(end_date))
    ][date_column]
    return [item.strftime("%Y-%m-%d") for item in dates.dropna().sort_values()]


def _latest_trade_date() -> str:
    return (_trade_dates_from_calendar("1990-01-01", _today()) or [_today()])[-1]


def _latest_trade_date_on_or_before(date_text: str) -> str:
    dates = _trade_dates_from_calendar("1990-01-01", date_text)
    if dates:
        return dates[-1]
    return date_text


def _valid_north_history(df: pd.DataFrame | None, trade_date: str, limit: int = 60) -> pd.DataFrame | None:
    if df is None or df.empty or "当日成交净买额" not in df.columns or "日期" not in df.columns:
        return None
    clean = df.copy()
    clean["日期"] = pd.to_datetime(clean["日期"], errors="coerce")
    clean["当日成交净买额"] = pd.to_numeric(clean["当日成交净买额"], errors="coerce")
    if "当日资金流入" in clean.columns:
        clean["当日资金流入"] = pd.to_numeric(clean["当日资金流入"], errors="coerce")
    target = pd.to_datetime(trade_date, errors="coerce")
    valid = clean[clean["当日成交净买额"].notna()]
    if pd.notna(target):
        valid = valid[valid["日期"] <= target]
    valid = valid.sort_values("日期").tail(limit)
    if valid.empty:
        return None
    valid = valid.copy()
    valid["日期"] = valid["日期"].dt.strftime("%Y-%m-%d")
    return valid


def _north_row_for_date(df: pd.DataFrame | None, trade_date: str) -> pd.Series | None:
    valid = _valid_north_history(df, trade_date, 1)
    if valid is None or valid.empty:
        return None
    row = valid.iloc[-1]
    return row if str(row.get("日期", "")) == trade_date else None


def _row_for_trade_date(df: pd.DataFrame | None, date_column: str, trade_date: str) -> pd.Series | None:
    if df is None or df.empty or date_column not in df.columns:
        return None
    clean = df.copy()
    clean[date_column] = pd.to_datetime(clean[date_column], errors="coerce")
    target = pd.to_datetime(trade_date, errors="coerce")
    if pd.isna(target):
        return None
    valid = clean[clean[date_column] <= target].sort_values(date_column)
    if valid.empty:
        return None
    row = valid.iloc[-1]
    return row if row[date_column].strftime("%Y-%m-%d") == trade_date else None


def _market_flow_row_for_date(df: pd.DataFrame | None, trade_date: str) -> pd.Series | None:
    if df is None or df.empty or "日期" not in df.columns:
        return None
    row = _row_for_trade_date(df, "日期", trade_date)
    if row is not None:
        return row
    clean = df.copy()
    clean["日期"] = pd.to_datetime(clean["日期"], errors="coerce")
    valid = clean[clean["日期"].notna()].sort_values("日期")
    return valid.iloc[-1] if not valid.empty else None


def _market_flow_payload(row: pd.Series | None, trade_date: str) -> dict | None:
    if row is None:
        return None
    source_date = _normalize_date(row.get("日期"))
    return {
        "date": source_date,
        "shClose": _safe_float(row.get("上证-收盘价")),
        "shChangePercent": _safe_float(row.get("上证-涨跌幅")),
        "szClose": _safe_float(row.get("深证-收盘价")),
        "szChangePercent": _safe_float(row.get("深证-涨跌幅")),
        "mainNetInflow": _safe_float(row.get("主力净流入-净额")),
        "mainNetInflowRatio": _safe_float(row.get("主力净流入-净占比")),
        "dateMatched": source_date == trade_date,
    }


def _spot_source_date(trade_date: str, latest_trade_date: str) -> str:
    return latest_trade_date if trade_date == latest_trade_date else latest_trade_date


def _filter_invalid_limit_pool_df(df: pd.DataFrame | None, label: str) -> pd.DataFrame | None:
    if df is None or df.empty or "涨跌幅" not in df.columns or "最新价" not in df.columns:
        return df
    clean = df.copy()
    changes = pd.to_numeric(clean.get("涨跌幅"), errors="coerce")
    prices = pd.to_numeric(clean.get("最新价"), errors="coerce")
    invalid = (prices <= 0) | (changes.abs() >= 50)
    if invalid.any():
        logger.warning("[market_download] filtered %s invalid rows: %s", label, int(invalid.sum()))
    return clean[~invalid].copy()


def _build_overview(
    trade_date: str,
    spot_df: pd.DataFrame | None,
    north_summary_df: pd.DataFrame | None,
    north_hist_df: pd.DataFrame | None,
    market_flow_df: pd.DataFrame | None,
    limit_up_df: pd.DataFrame | None,
    limit_down_df: pd.DataFrame | None,
    source_errors: dict[str, str] | None = None,
    latest_trade_date: str | None = None,
) -> dict:
    latest_trade_date = latest_trade_date or _latest_trade_date()
    spot_is_exact = trade_date == latest_trade_date
    total_turnover = 0.0
    up_count = down_count = flat_count = 0
    avg_change = median_change = 0.0
    if spot_df is not None and not spot_df.empty:
        changes = pd.to_numeric(spot_df.get("涨跌幅"), errors="coerce")
        amounts = pd.to_numeric(spot_df.get("成交额"), errors="coerce")
        total_turnover = _safe_float(amounts.sum())
        up_count = int((changes > 0).sum())
        down_count = int((changes < 0).sum())
        flat_count = int((changes == 0).sum())
        avg_change = _safe_float(changes.mean())
        median_change = _safe_float(changes.median())

    north_net_buy: float | None = None
    north_net_inflow: float | None = None
    north_data_date = ""
    north_data_status = "无当日有效北向成交净买额"
    north_row = _north_row_for_date(north_hist_df, trade_date)
    if north_row is not None:
        north_net_buy = _safe_float(north_row.get("当日成交净买额"))
        north_net_inflow = _safe_float(north_row.get("当日资金流入"))
        north_data_date = str(north_row.get("日期", ""))
        north_data_status = "exact"

    market_flow = _market_flow_payload(_market_flow_row_for_date(market_flow_df, trade_date), trade_date)
    source_errors = source_errors or {}
    warning = ""
    if not spot_is_exact:
        warning = f"个股行情接口为当前快照，源交易日 {latest_trade_date} 与请求日 {trade_date} 不一致，相关涨跌家数/成交额仅供参考"

    return {
        "tradeDate": trade_date,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "totalTurnover": round(total_turnover, 2),
        "upCount": up_count,
        "downCount": down_count,
        "flatCount": flat_count,
        "avgChangePercent": round(avg_change, 2),
        "medianChangePercent": round(median_change, 2),
        "northNetBuy": round(north_net_buy, 2) if north_net_buy is not None else None,
        "northNetInflow": round(north_net_inflow, 2) if north_net_inflow is not None else None,
        "northDataDate": north_data_date,
        "northDataStatus": north_data_status,
        "limitUpCount": len(limit_up_df) if limit_up_df is not None else 0,
        "limitDownCount": len(limit_down_df) if limit_down_df is not None else 0,
        "limitUpAvailable": not bool(source_errors.get("limit_up_pool")),
        "limitDownAvailable": not bool(source_errors.get("limit_down_pool")),
        "sourceErrors": source_errors,
        "marketFlow": market_flow,
        "source": "akshare",
        "meta": _source_meta(
            trade_date,
            "overview",
            "akshare",
            "stock_zh_a_spot_em + stock_market_fund_flow",
            _spot_source_date(trade_date, latest_trade_date),
            historical=False,
            status="warning" if warning else "ok",
            warning=warning,
        ),
    }


def _build_sentiment(
    trade_date: str,
    limit_up_df: pd.DataFrame | None,
    limit_down_df: pd.DataFrame | None,
    source_errors: dict[str, str] | None = None,
) -> dict:
    limit_up_records = _records_from_df(limit_up_df)
    limit_down_records = _records_from_df(limit_down_df)
    highest_board = 0
    leaders: list[dict] = []

    for row in limit_up_records:
        board_count = _safe_int(row.get("连板数"))
        highest_board = max(highest_board, board_count)
        leaders.append({
            "symbol": str(row.get("代码", "")),
            "name": str(row.get("名称", "")),
            "industry": str(row.get("所属行业", "")),
            "changePercent": _safe_float(row.get("涨跌幅")),
            "boardCount": board_count,
            "sealAmount": _safe_float(row.get("封板资金")),
            "firstLimitTime": str(row.get("首次封板时间", "")),
            "breakCount": _safe_int(row.get("炸板次数")),
        })

    leaders.sort(key=lambda item: (item["boardCount"], item["sealAmount"]), reverse=True)
    break_count = sum(_safe_int(row.get("炸板次数")) for row in limit_up_records)
    limit_up_count = len(limit_up_records)
    limit_down_count = len(limit_down_records)
    hot_industries: dict[str, int] = {}
    for row in limit_up_records:
        industry = str(row.get("所属行业", "未知") or "未知")
        hot_industries[industry] = hot_industries.get(industry, 0) + 1

    source_errors = source_errors or {}
    limit_up_available = not bool(source_errors.get("limit_up_pool"))
    limit_down_available = not bool(source_errors.get("limit_down_pool"))
    if not limit_up_available and not limit_down_available:
        phase = "数据不足"
    elif limit_up_count >= 80 and highest_board >= 4:
        phase = "主升期"
    elif limit_up_count >= 40 and highest_board >= 2:
        phase = "启动期"
    elif (limit_down_available and limit_down_count >= 30) or (limit_up_available and limit_up_count < 20):
        phase = "退潮期"
    else:
        phase = "震荡期"

    return {
        "tradeDate": trade_date,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "limitUpCount": limit_up_count,
        "limitDownCount": limit_down_count,
        "limitUpAvailable": limit_up_available,
        "limitDownAvailable": limit_down_available,
        "dataQuality": "complete" if limit_up_available and limit_down_available else "partial",
        "sourceErrors": source_errors,
        "highestBoard": highest_board,
        "breakCount": break_count,
        "breakRate": round(break_count / max(limit_up_count + break_count, 1) * 100, 2),
        "marketPhase": phase,
        "hotIndustries": [
            {"industry": industry, "limitUpCount": count}
            for industry, count in sorted(hot_industries.items(), key=lambda item: item[1], reverse=True)[:10]
        ],
        "leaders": leaders[:20],
        "meta": _source_meta(trade_date, "sentiment", "akshare", "stock_zt_pool_em + stock_zt_pool_dtgc_em"),
    }


def _index_metrics(symbol: str, name: str, group: str, df: pd.DataFrame | None, trade_date: str) -> dict | None:
    if df is None or df.empty or "date" not in df.columns:
        return None
    clean = df.copy()
    clean["date"] = pd.to_datetime(clean["date"], errors="coerce")
    clean = clean[clean["date"].notna()].sort_values("date")
    target = pd.to_datetime(trade_date, errors="coerce")
    if pd.isna(target):
        return None
    valid = clean[clean["date"] <= target]
    if valid.empty:
        return None
    row = valid.iloc[-1]
    source_date = row["date"].strftime("%Y-%m-%d")
    close = _safe_float(row.get("close"))
    prev = valid.iloc[-2] if len(valid) >= 2 else None
    prev_close = _safe_float(prev.get("close")) if prev is not None else 0.0

    def change_from(days: int) -> float | None:
        if len(valid) <= days:
            return None
        base = _safe_float(valid.iloc[-days - 1].get("close"))
        if not base:
            return None
        return round((close - base) / base * 100, 2)

    change = close - prev_close if prev_close else 0.0
    change_percent = change / prev_close * 100 if prev_close else 0.0
    return {
        "symbol": symbol,
        "name": name,
        "group": group,
        "sourceDate": source_date,
        "dateMatched": source_date == trade_date,
        "open": round(_safe_float(row.get("open")), 3),
        "high": round(_safe_float(row.get("high")), 3),
        "low": round(_safe_float(row.get("low")), 3),
        "close": round(close, 3),
        "volume": _safe_float(row.get("volume")),
        "change": round(change, 3),
        "changePercent": round(change_percent, 2),
        "change5d": change_from(5),
        "change20d": change_from(20),
        "change60d": change_from(60),
    }


def _build_market_indices(trade_date: str, index_results: list[tuple[dict, pd.DataFrame | None, str | None]]) -> dict:
    items = []
    errors: dict[str, str] = {}
    for config, df, error in index_results:
        if error:
            errors[config["symbol"]] = error
            continue
        metric = _index_metrics(config["symbol"], config["name"], config["group"], df, trade_date)
        if metric:
            items.append(metric)
        else:
            errors[config["symbol"]] = "无可用历史行情"
    leader = max(items, key=lambda item: item["changePercent"], default=None)
    laggard = min(items, key=lambda item: item["changePercent"], default=None)
    matched = sum(1 for item in items if item.get("dateMatched"))
    return {
        "tradeDate": trade_date,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "items": items,
        "leader": leader,
        "laggard": laggard,
        "coverage": {"matched": matched, "total": len(items)},
        "sourceErrors": errors,
        "meta": _source_meta(trade_date, "market_indices", "akshare", "stock_zh_index_daily", trade_date, historical=True, status="ok" if matched == len(items) else "warning"),
    }


def _build_breadth(trade_date: str, spot_df: pd.DataFrame | None, high_low_df: pd.DataFrame | None, activity_df: pd.DataFrame | None, latest_trade_date: str) -> dict:
    spot_exact = trade_date == latest_trade_date
    distribution = []
    ma_breadth = {}
    turnover_stats = {}
    if spot_df is not None and not spot_df.empty:
        changes = pd.to_numeric(spot_df.get("涨跌幅"), errors="coerce")
        amounts = pd.to_numeric(spot_df.get("成交额"), errors="coerce")
        bins = [(-100, -10, "≤-10%"), (-10, -5, "-10~-5%"), (-5, -2, "-5~-2%"), (-2, 0, "-2~0%"), (0, 2, "0~2%"), (2, 5, "2~5%"), (5, 10, "5~10%"), (10, 100, "≥10%")]
        for low, high, label in bins:
            if label in {"≤-10%", "≥10%"}:
                count = int((changes <= high).sum()) if label == "≤-10%" else int((changes >= low).sum())
            else:
                count = int(((changes > low) & (changes <= high)).sum())
            distribution.append({"range": label, "count": count})
        turnover_stats = {
            "total": round(_safe_float(amounts.sum()), 2),
            "median": round(_safe_float(amounts.median()), 2),
            "activeCountOver100m": int((amounts >= 100_000_000).sum()),
        }
        for col, label in [("最新价", "maProxy")]:
            if col in spot_df.columns:
                ma_breadth[label] = int(pd.to_numeric(spot_df[col], errors="coerce").notna().sum())

    high_low_row = _row_for_trade_date(high_low_df, "date", trade_date)
    if high_low_row is None and high_low_df is not None and not high_low_df.empty and "date" in high_low_df.columns:
        clean_high_low = high_low_df.copy()
        clean_high_low["date"] = pd.to_datetime(clean_high_low["date"], errors="coerce")
        target = pd.to_datetime(trade_date, errors="coerce")
        valid_high_low = clean_high_low[clean_high_low["date"].notna()]
        if pd.notna(target):
            valid_high_low = valid_high_low[valid_high_low["date"] <= target]
        valid_high_low = valid_high_low.sort_values("date")
        if not valid_high_low.empty:
            high_low_row = valid_high_low.iloc[-1]
    high_low = None
    if high_low_row is not None:
        high_low = {
            "sourceDate": _normalize_date(high_low_row.get("date")),
            "dateMatched": _normalize_date(high_low_row.get("date")) == trade_date,
            "close": _safe_float(high_low_row.get("close")),
            "high20": _safe_int(high_low_row.get("high20")),
            "low20": _safe_int(high_low_row.get("low20")),
            "high60": _safe_int(high_low_row.get("high60")),
            "low60": _safe_int(high_low_row.get("low60")),
            "high120": _safe_int(high_low_row.get("high120")),
            "low120": _safe_int(high_low_row.get("low120")),
        }

    activity = _records_from_df(activity_df)
    activity_date = ""
    for row in activity:
        if row.get("item") == "统计日期":
            activity_date = _normalize_date(row.get("value"))
            break

    warning = "" if spot_exact else f"涨跌分布来自当前个股快照 {latest_trade_date}，与请求日 {trade_date} 不一致"
    return {
        "tradeDate": trade_date,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "distribution": distribution,
        "newHighLow": high_low,
        "activity": activity,
        "activityDate": activity_date,
        "turnoverStats": turnover_stats,
        "maBreadth": ma_breadth,
        "meta": _source_meta(trade_date, "breadth", "akshare", "stock_zh_a_spot_em + stock_a_high_low_statistics + stock_market_activity_legu", latest_trade_date, historical=False, status="warning" if warning else "ok", warning=warning),
    }


def _build_style_rotation(trade_date: str, index_items: list[dict]) -> dict:
    by_symbol = {item["symbol"]: item for item in index_items}
    styles = []
    for style in STYLE_DEFINITIONS:
        index = by_symbol.get(style["symbol"])
        if not index:
            continue
        score = _safe_float(index.get("changePercent")) * 0.5 + _safe_float(index.get("change5d")) * 0.3 + _safe_float(index.get("change20d")) * 0.2
        styles.append({
            "style": style["name"],
            "indexName": style["indexName"],
            "symbol": style["symbol"],
            "sourceDate": index.get("sourceDate"),
            "changePercent": index.get("changePercent"),
            "change5d": index.get("change5d"),
            "change20d": index.get("change20d"),
            "change60d": index.get("change60d"),
            "score": round(score, 2),
        })
    styles.sort(key=lambda item: item["score"], reverse=True)
    return {
        "tradeDate": trade_date,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "styles": styles,
        "leader": styles[0] if styles else None,
        "laggard": styles[-1] if styles else None,
        "meta": _source_meta(trade_date, "style_rotation", "akshare", "derived from stock_zh_index_daily", trade_date, historical=True),
    }


def _limit_pool_anomalies(records: list[dict], field: str) -> list[str]:
    anomalies = []
    for row in records[:200]:
        change = _safe_float(row.get("涨跌幅"))
        price = _safe_float(row.get("最新价"))
        if abs(change) >= 50 or price <= 0:
            anomalies.append(f"{row.get('代码', '')} {row.get('名称', '')} {field} 异常: 涨跌幅={change}, 价格={price}")
        if len(anomalies) >= 10:
            break
    return anomalies


def _build_quality_report(trade_date: str, payloads: dict[str, Any], source_errors: dict[str, str], latest_trade_date: str) -> dict:
    checks = []

    def add(check: str, status: str, message: str, severity: str = "info") -> None:
        checks.append({"check": check, "status": status, "severity": severity, "message": message})

    if source_errors:
        for key, value in source_errors.items():
            add(f"source:{key}", "failed", f"{DATA_TYPE_LABELS.get(key, key)}接口失败：{value}", "error")
    else:
        add("source", "passed", "核心数据源请求成功")

    overview = payloads.get("overview") or {}
    meta = overview.get("meta") or {}
    if meta.get("status") == "warning":
        add("overview_date", "warning", meta.get("warning", "概览日期存在不一致"), "warning")
    else:
        add("overview_date", "passed", "概览快照日期与请求日一致")

    market_flow = overview.get("marketFlow")
    if market_flow and not market_flow.get("dateMatched"):
        add("market_flow_date", "warning", f"大盘资金流源日期 {market_flow.get('date')} 与请求日 {trade_date} 不一致", "warning")

    indices = payloads.get("market_indices") or {}
    coverage = indices.get("coverage") or {}
    if coverage.get("total") and coverage.get("matched") != coverage.get("total"):
        add("index_coverage", "warning", f"核心指数仅 {coverage.get('matched')}/{coverage.get('total')} 精确匹配交易日", "warning")
    else:
        add("index_coverage", "passed", "核心指数日期匹配")

    if trade_date != latest_trade_date:
        add("spot_replay", "warning", f"AKShare 个股实时行情无法历史回放，当前源交易日为 {latest_trade_date}", "warning")

    for data_type in ["limit_up_pool", "limit_down_pool"]:
        data = payloads.get(data_type)
        if isinstance(data, list):
            anomalies = _limit_pool_anomalies(data, DATA_TYPE_LABELS[data_type])
            if anomalies:
                add(f"anomaly:{data_type}", "warning", "；".join(anomalies), "warning")
            else:
                add(f"anomaly:{data_type}", "passed", f"{DATA_TYPE_LABELS[data_type]}未发现明显异常")

    error_count = sum(1 for item in checks if item["severity"] == "error")
    warning_count = sum(1 for item in checks if item["severity"] == "warning")
    score = max(0, 100 - error_count * 30 - warning_count * 10)
    if error_count:
        level = "error"
    elif warning_count:
        level = "warning"
    else:
        level = "complete"
    return {
        "tradeDate": trade_date,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "level": level,
        "score": score,
        "summary": f"{len(checks)} 项检查，{error_count} 个错误，{warning_count} 个警告",
        "checks": checks,
        "meta": _source_meta(trade_date, "quality_report", "internal", "market data validation", trade_date, historical=True),
    }


async def _fetch_source(label: str, func, *args, timeout: int = 60, **kwargs) -> tuple[pd.DataFrame | None, str | None]:
    try:
        return await asyncio.wait_for(asyncio.to_thread(func, *args, **kwargs), timeout=timeout), None
    except TimeoutError:
        message = f"接口请求超时（{timeout} 秒）"
        logger.warning("[market_download] %s timeout: %s", label, message)
        return None, message
    except Exception as e:
        message = str(e)
        logger.warning("[market_download] %s failed: %s", label, message)
        return None, message


def _unavailable_payload(trade_date: str, data_type: str, error: str) -> dict:
    return {
        "tradeDate": trade_date,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "dataType": data_type,
        "available": False,
        "items": [],
        "error": error,
        "meta": _source_meta(trade_date, data_type, "akshare", "unknown", "", status="failed", warning=error),
    }


async def _fetch_index(config: dict) -> tuple[dict, pd.DataFrame | None, str | None]:
    df, error = await _fetch_source(config["name"], ak.stock_zh_index_daily, symbol=config["symbol"], timeout=45)
    return config, df, error


async def download_market_data(trade_date: str | None = None) -> dict[str, Any]:
    trade_date = trade_date or _today()
    ak_trade_date = _ak_date(trade_date)
    latest_trade_date = _latest_trade_date()
    stats: dict[str, Any] = {"__errors__": []}

    base_results = await asyncio.gather(
        _fetch_source("个股行情", fetch_all_stocks, timeout=90),
        _fetch_source("互联互通概览", ak.stock_hsgt_fund_flow_summary_em, timeout=45),
        _fetch_source("北向资金历史", ak.stock_hsgt_hist_em, symbol="北向资金", timeout=90),
        _fetch_source("行业涨幅", ak.stock_board_industry_name_em, timeout=45),
        _fetch_source("行业资金流", ak.stock_sector_fund_flow_rank, indicator="今日", sector_type="行业资金流", timeout=45),
        _fetch_source("涨停池", ak.stock_zt_pool_em, date=ak_trade_date, timeout=30),
        _fetch_source("跌停池", ak.stock_zt_pool_dtgc_em, date=ak_trade_date, timeout=30),
        _fetch_source("大盘资金流", ak.stock_market_fund_flow, timeout=45),
        _fetch_source("创新高新低", ak.stock_a_high_low_statistics, symbol="all", timeout=45),
        _fetch_source("赚钱效应", ak.stock_market_activity_legu, timeout=45),
        *( _fetch_index(config) for config in INDEX_SYMBOLS ),
    )

    (
        (spot_df, spot_error),
        (north_summary_df, north_summary_error),
        (north_hist_df, north_hist_error),
        (sector_rank_df, sector_rank_error),
        (sector_fund_flow_df, sector_fund_flow_error),
        (limit_up_df, limit_up_error),
        (limit_down_df, limit_down_error),
        (market_flow_df, market_flow_error),
        (high_low_df, high_low_error),
        (activity_df, activity_error),
        *index_results,
    ) = base_results

    limit_up_df = _filter_invalid_limit_pool_df(limit_up_df, "涨停池")
    limit_down_df = _filter_invalid_limit_pool_df(limit_down_df, "跌停池")

    error_map = {
        "overview": spot_error or market_flow_error,
        "north_money": north_summary_error or north_hist_error,
        "sector_rank": sector_rank_error,
        "sector_fund_flow": sector_fund_flow_error,
        "limit_up_pool": limit_up_error,
        "limit_down_pool": limit_down_error,
        "breadth": high_low_error or activity_error,
    }
    source_errors = {key: value for key, value in error_map.items() if value}
    stats["__source_errors__"] = source_errors
    stats["__errors__"] = [f"{DATA_TYPE_LABELS.get(key, key)}: {value}" for key, value in source_errors.items()]

    payloads: dict[str, Any] = {}

    overview = _build_overview(trade_date, spot_df, north_summary_df, north_hist_df, market_flow_df, limit_up_df, limit_down_df, source_errors, latest_trade_date)
    market_data_store.save_market_data(trade_date, "overview", overview)
    payloads["overview"] = overview
    stats["overview"] = 1

    market_indices = _build_market_indices(trade_date, index_results)  # type: ignore[arg-type]
    market_data_store.save_market_data(trade_date, "market_indices", market_indices)
    payloads["market_indices"] = market_indices
    stats["market_indices"] = len(market_indices.get("items") or [])

    breadth = _build_breadth(trade_date, spot_df, high_low_df, activity_df, latest_trade_date)
    market_data_store.save_market_data(trade_date, "breadth", breadth)
    payloads["breadth"] = breadth
    stats["breadth"] = len(breadth.get("distribution") or []) + (1 if breadth.get("newHighLow") else 0)

    style_rotation = _build_style_rotation(trade_date, market_indices.get("items") or [])
    market_data_store.save_market_data(trade_date, "style_rotation", style_rotation)
    payloads["style_rotation"] = style_rotation
    stats["style_rotation"] = len(style_rotation.get("styles") or [])

    valid_north_hist_df = _valid_north_history(north_hist_df, trade_date, 60)
    north_money = {
        "tradeDate": trade_date,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "available": not bool(source_errors.get("north_money")),
        "error": source_errors.get("north_money", ""),
        "summary": _records_from_df(north_summary_df),
        "history": _records_from_df(valid_north_hist_df),
        "historyNote": "仅保留当日成交净买额有效的最近 60 条记录；若源接口停止更新则以质量报告提示为准",
        "latestValidDate": str(valid_north_hist_df.iloc[-1].get("日期", "")) if valid_north_hist_df is not None and not valid_north_hist_df.empty else "",
        "meta": _source_meta(trade_date, "north_money", "akshare", "stock_hsgt_fund_flow_summary_em + stock_hsgt_hist_em", str(valid_north_hist_df.iloc[-1].get("日期", "")) if valid_north_hist_df is not None and not valid_north_hist_df.empty else "", historical=True),
    }
    market_data_store.save_market_data(trade_date, "north_money", north_money)
    payloads["north_money"] = north_money
    stats["north_money"] = len(north_money["summary"])

    for data_type, df, error_key in [
        ("sector_rank", sector_rank_df, "sector_rank"),
        ("sector_fund_flow", sector_fund_flow_df, "sector_fund_flow"),
        ("limit_up_pool", limit_up_df, "limit_up_pool"),
        ("limit_down_pool", limit_down_df, "limit_down_pool"),
    ]:
        if source_errors.get(error_key):
            payload = _unavailable_payload(trade_date, data_type, source_errors[error_key])
            market_data_store.save_market_data(trade_date, data_type, payload)
            payloads[data_type] = payload
            stats[data_type] = 0
        else:
            payload = _records_from_df(df)
            market_data_store.save_market_data(trade_date, data_type, payload)
            payloads[data_type] = payload
            stats[data_type] = len(payload)

    sentiment = _build_sentiment(trade_date, limit_up_df, limit_down_df, source_errors)
    market_data_store.save_market_data(trade_date, "sentiment", sentiment)
    payloads["sentiment"] = sentiment
    stats["sentiment"] = 1

    quality_report = _build_quality_report(trade_date, payloads, source_errors, latest_trade_date)
    market_data_store.save_market_data(trade_date, "quality_report", quality_report)
    stats["quality_report"] = len(quality_report.get("checks") or [])
    stats["__quality_level__"] = quality_report.get("level")

    return stats


def _dedupe_trade_dates(dates: list[str]) -> list[str]:
    return sorted(dict.fromkeys(date for date in dates if date))


def get_trade_dates(start_date: str | None = None, end_date: str | None = None) -> list[str]:
    start = datetime.strptime(start_date or end_date or _today(), "%Y-%m-%d").date()
    end = datetime.strptime(end_date or start_date or _today(), "%Y-%m-%d").date()
    if start > end:
        start, end = end, start
    dates = _trade_dates_from_calendar(start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
    if dates:
        return dates
    return [_latest_trade_date_on_or_before(end.strftime("%Y-%m-%d"))]


def _date_range(
    start_date: str | None = None,
    end_date: str | None = None,
    trade_date: str | None = None,
    trade_dates: list[str] | None = None,
) -> list[str]:
    if trade_dates:
        return _dedupe_trade_dates([_latest_trade_date_on_or_before(date) for date in trade_dates])
    if trade_date:
        return [_latest_trade_date_on_or_before(trade_date)]
    if not start_date and not end_date:
        return [_latest_trade_date()]
    return get_trade_dates(start_date, end_date)


async def _run_market_download(
    trade_dates: list[str],
    *,
    all_trade_dates: list[str] | None = None,
    total_steps: int | None = None,
    completed_count: int = 0,
    failed_items: list[str] | None = None,
    logs: list[str] | None = None,
    started_at: str | None = None,
):
    global _market_download_task, _pause_requested, _cancel_requested
    install_default_executor()
    logs = list(logs or [])
    data_types = list(market_data_store.MARKET_DATA_TYPES)
    all_trade_dates = all_trade_dates or trade_dates
    total_steps = total_steps or len(all_trade_dates) * len(data_types)
    failed_items = list(failed_items or [])
    completed_trade_dates: set[str] = set()
    current_trade_date = trade_dates[0] if trade_dates else (all_trade_dates[0] if all_trade_dates else _today())
    running_dates: set[str] = set()
    started_at = started_at or datetime.now().isoformat()
    state_lock = asyncio.Lock()

    if completed_count:
        previous_state = market_data_store.load_market_download_state() or {}
        completed_trade_dates = set(previous_state.get("completedTradeDates") or [])
        if completed_trade_dates:
            completed_count = len(completed_trade_dates) * len(data_types)

    pending_dates = [date for date in trade_dates if date not in completed_trade_dates]
    concurrency = min(MARKET_DATE_CONCURRENCY, max(1, len(pending_dates))) if pending_dates else 1

    def _effective_status(status: str) -> str:
        if status == "running" and _cancel_requested:
            return "cancelling"
        if status == "running" and _pause_requested:
            return "pausing"
        return status

    def _save_state(status: str, current_type: str | None = None):
        market_data_store.save_market_download_state({
            "status": _effective_status(status),
            "jobId": started_at.replace(":", "").replace("-", "").replace(".", ""),
            "tradeDate": current_trade_date,
            "tradeDates": all_trade_dates,
            "total": total_steps,
            "completed": completed_count,
            "failed": failed_items,
            "currentType": current_type,
            "startedAt": started_at,
            "updatedAt": datetime.now().isoformat(),
            "dataTypes": data_types,
            "logs": logs,
            "concurrency": concurrency,
            "maxThreads": MAX_DOWNLOAD_THREADS,
            "runningDates": sorted(running_dates),
            "completedTradeDates": sorted(completed_trade_dates),
        })

    async def _stop_if_requested() -> bool:
        if _cancel_requested:
            async with state_lock:
                _append_log(logs, "已取消市场数据下载任务")
                _save_state("cancelled", None)
            return True
        if _pause_requested:
            async with state_lock:
                _append_log(logs, "已暂停市场数据下载任务，可点击继续下载剩余日期")
                _save_state("paused", None)
            return True
        return False

    if not pending_dates:
        _append_log(logs, "没有需要下载的市场日期")
        _save_state("completed", None)
        _market_download_task = None
        return

    if not logs:
        _append_log(logs, f"开始下载 {pending_dates[0]} 至 {pending_dates[-1]} 市场数据，共 {len(pending_dates)} 个交易日")
    _append_log(logs, f"市场日期并发 {concurrency}，线程上限 {MAX_DOWNLOAD_THREADS}")
    _save_state("running", "初始化")

    queue: asyncio.Queue[str] = asyncio.Queue()
    for trade_date in pending_dates:
        queue.put_nowait(trade_date)

    async def worker(worker_id: int) -> None:
        nonlocal completed_count, current_trade_date
        while not (_cancel_requested or _pause_requested):
            try:
                trade_date = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            async with state_lock:
                current_trade_date = trade_date
                running_dates.add(trade_date)
                _append_log(logs, f"W{worker_id} 开始下载 {trade_date}：请求 AKShare 市场、指数、行业、资金与涨跌停接口...")
                _save_state("running", "请求数据源")
            try:
                stats = await download_market_data(trade_date)
            except Exception as e:
                async with state_lock:
                    failed_items.append(f"{trade_date}: {e}")
                    _append_log(logs, f"{trade_date} 错误: {e}")
                    completed_count += len(data_types)
                    running_dates.discard(trade_date)
                    completed_trade_dates.add(trade_date)
                    _save_state("running", "失败跳过")
                queue.task_done()
                continue

            source_errors = stats.get("__source_errors__", {}) if isinstance(stats, dict) else {}
            quality_level = stats.get("__quality_level__") if isinstance(stats, dict) else None
            async with state_lock:
                for data_type in data_types:
                    label = DATA_TYPE_LABELS.get(data_type, data_type)
                    count = stats.get(data_type, 0)
                    if source_errors.get(data_type):
                        _append_log(logs, f"{trade_date} {label}: 接口不可用，已跳过（{source_errors[data_type]}）")
                    else:
                        suffix = f"，质量={quality_level}" if data_type == "quality_report" and quality_level else ""
                        _append_log(logs, f"{trade_date} {label}: {count} 条 ✓{suffix}" if count > 0 else f"{trade_date} {label}: 无数据{suffix}")
                    completed_count += 1
                running_dates.discard(trade_date)
                completed_trade_dates.add(trade_date)
                current_trade_date = trade_date
                _save_state("running", trade_date)
            queue.task_done()

    try:
        workers = [asyncio.create_task(worker(index + 1)) for index in range(concurrency)]
        await asyncio.gather(*workers)
        if await _stop_if_requested():
            return
        _append_log(logs, f"市场数据下载完成，成功 {len(completed_trade_dates) - len(failed_items)} / {len(all_trade_dates)} 个交易日")
        _save_state("completed" if not failed_items else "error", None)
    except Exception as e:
        logger.error("[market_download] failed: %s", e, exc_info=True)
        failed_items.append(str(e))
        _append_log(logs, f"错误: {e}")
        _save_state("error", None)
    finally:
        _market_download_task = None
        if not _pause_requested:
            _cancel_requested = False


async def start_market_download(
    trade_date: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    trade_dates: list[str] | None = None,
) -> dict:
    global _market_download_task, _pause_requested, _cancel_requested
    if _market_download_task and not _market_download_task.done():
        return {"status": "running"}

    _pause_requested = False
    _cancel_requested = False
    requested_label = "、".join(trade_dates) if trade_dates else (trade_date or f"{start_date or end_date or _today()} 至 {end_date or start_date or _today()}")
    requested_dates = list(trade_dates or [])
    trade_dates = _date_range(start_date, end_date, trade_date, requested_dates)
    normalized_note = ""
    if trade_date and trade_dates and trade_dates[0] != trade_date:
        normalized_note = f"；请求日期 {trade_date} 非交易日，已自动使用最近交易日 {trade_dates[0]}"
    if requested_dates and trade_dates != _dedupe_trade_dates(requested_dates):
        normalized_note = "；已按交易日历过滤/归一化缺失日期"
    now = datetime.now().isoformat()
    market_data_store.save_market_download_state({
        "status": "running",
        "jobId": now.replace(":", "").replace("-", "").replace(".", ""),
        "tradeDate": trade_dates[0],
        "tradeDates": trade_dates,
        "total": len(trade_dates) * len(market_data_store.MARKET_DATA_TYPES),
        "completed": 0,
        "failed": [],
        "currentType": "初始化",
        "startedAt": now,
        "updatedAt": now,
        "dataTypes": list(market_data_store.MARKET_DATA_TYPES),
        "logs": [f"[{datetime.now().strftime('%H:%M:%S')}] 已提交 {trade_dates[0]} 至 {trade_dates[-1]} 市场数据下载任务{normalized_note}"],
    })
    _market_download_task = asyncio.create_task(_run_market_download(trade_dates, logs=[f"请求范围：{requested_label}{normalized_note}"]))
    return {"status": "started", "tradeDates": trade_dates, "requested": requested_label, "normalizedNote": normalized_note, "total": len(trade_dates) * len(market_data_store.MARKET_DATA_TYPES)}


def _update_control_state(status: str, current_type: str) -> dict:
    state = market_data_store.load_market_download_state() or get_market_download_status()
    logs = list(state.get("logs") or [])
    _append_log(logs, current_type)
    state.update({
        "status": status,
        "currentType": current_type,
        "updatedAt": datetime.now().isoformat(),
        "logs": logs,
    })
    market_data_store.save_market_download_state(state)
    return state


async def pause_market_download() -> dict:
    global _pause_requested
    state = market_data_store.load_market_download_state() or get_market_download_status()
    if state.get("status") not in {"running", "pausing"}:
        return {"status": state.get("status", "idle")}
    _pause_requested = True
    if not (_market_download_task and not _market_download_task.done()):
        _update_control_state("paused", "已暂停市场数据下载任务")
        return {"status": "paused"}
    _update_control_state("pausing", "暂停中：当前日期下载完成后生效")
    return {"status": "pausing"}


async def cancel_market_download() -> dict:
    global _cancel_requested
    state = market_data_store.load_market_download_state() or get_market_download_status()
    if state.get("status") not in {"running", "pausing", "paused", "cancelling"}:
        return {"status": state.get("status", "idle")}
    _cancel_requested = True
    if not (_market_download_task and not _market_download_task.done()):
        _update_control_state("cancelled", "已取消市场数据下载任务")
        return {"status": "cancelled"}
    _update_control_state("cancelling", "取消中：当前日期下载完成后停止")
    return {"status": "cancelling"}


async def resume_market_download() -> dict:
    global _market_download_task, _pause_requested, _cancel_requested
    state = market_data_store.load_market_download_state() or get_market_download_status()
    if _market_download_task and not _market_download_task.done():
        _pause_requested = False
        _cancel_requested = False
        _update_control_state("running", "继续下载")
        return {"status": "running"}

    trade_dates = list(state.get("tradeDates") or [])
    data_types = list(state.get("dataTypes") or market_data_store.MARKET_DATA_TYPES)
    completed = int(state.get("completed") or 0)
    completed_trade_dates = set(state.get("completedTradeDates") or [])
    if completed_trade_dates:
        remaining_dates = [date for date in trade_dates if date not in completed_trade_dates]
    else:
        date_index = min(completed // max(len(data_types), 1), len(trade_dates))
        remaining_dates = trade_dates[date_index:]
    if not remaining_dates:
        _update_control_state("completed", "没有剩余日期需要继续")
        return {"status": "completed"}

    _pause_requested = False
    _cancel_requested = False
    logs = list(state.get("logs") or [])
    _append_log(logs, f"继续下载剩余 {len(remaining_dates)} 个交易日：{remaining_dates[0]} 至 {remaining_dates[-1]}")
    state.update({
        "status": "running",
        "tradeDate": remaining_dates[0],
        "currentType": "继续下载",
        "updatedAt": datetime.now().isoformat(),
        "logs": logs,
    })
    market_data_store.save_market_download_state(state)
    _market_download_task = asyncio.create_task(_run_market_download(
        remaining_dates,
        all_trade_dates=trade_dates,
        total_steps=int(state.get("total") or len(trade_dates) * len(data_types)),
        completed_count=completed,
        failed_items=list(state.get("failed") or []),
        logs=logs,
        started_at=state.get("startedAt") or datetime.now().isoformat(),
    ))
    return {"status": "started", "tradeDates": remaining_dates, "total": state.get("total")}


def get_market_download_status() -> dict:
    state = market_data_store.load_market_download_state()
    if state:
        return state
    return {
        "status": "idle",
        "jobId": None,
        "tradeDate": None,
        "total": 0,
        "completed": 0,
        "failed": [],
        "currentType": None,
        "startedAt": None,
        "updatedAt": None,
        "dataTypes": [],
        "logs": [],
    }


def reset_market_download_status() -> dict:
    global _pause_requested, _cancel_requested
    _pause_requested = False
    _cancel_requested = False
    market_data_store.save_market_download_state({
        "status": "idle",
        "jobId": None,
        "tradeDate": None,
        "total": 0,
        "completed": 0,
        "failed": [],
        "currentType": None,
        "startedAt": None,
        "updatedAt": None,
        "dataTypes": [],
        "logs": [],
    })
    return {"status": "ok"}
