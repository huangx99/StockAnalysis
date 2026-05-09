import json
import logging
import time
from datetime import datetime

import akshare as ak
import pandas as pd
import requests

from .column_schemas import (
    SPOT_EM_COLUMNS,
    HIST_COLUMNS,
    INDIVIDUAL_INFO_COLUMNS,
    NEWS_COLUMNS,
    FINANCIAL_PROFIT_COLUMNS,
    FINANCIAL_BALANCE_COLUMNS,
    FINANCIAL_CASHFLOW_COLUMNS,
    DIVIDEND_COLUMNS,
    NOTICE_COLUMNS,
    REPORT_COLUMNS,
)

logger = logging.getLogger(__name__)


class AKShareAdapterError(Exception):
    pass


class ColumnValidationError(Exception):
    pass


def _validate_and_normalize_df(
    df: pd.DataFrame | None,
    schema: dict,
    func_name: str,
) -> pd.DataFrame:
    if df is None or df.empty:
        raise AKShareAdapterError(f"{func_name} returned empty DataFrame")

    rename_map = schema.get("rename_map", {})
    if rename_map:
        for src, dst in rename_map.items():
            if src in df.columns:
                if dst in df.columns:
                    # Target already exists — drop source to avoid duplicate columns
                    df = df.drop(columns=[src])
                    logger.info(f"{func_name}: Dropped '{src}' (target '{dst}' already exists)")
                else:
                    df = df.rename(columns={src: dst})
                    logger.info(f"{func_name}: Renamed '{src}' → '{dst}'")

    missing = [c for c in schema["required"] if c not in df.columns]
    if missing:
        logger.error(
            f"{func_name}: Missing required columns: {missing}. "
            f"Available: {list(df.columns)}"
        )
        raise ColumnValidationError(
            f"{func_name}: Missing required columns: {missing}"
        )

    defaults = schema.get("defaults", {})
    for col in schema.get("optional", []):
        if col not in df.columns:
            df[col] = defaults.get(col, 0)
            logger.warning(f"{func_name}: Column '{col}' missing, using default")

    return df


def fetch_all_stocks() -> pd.DataFrame:
    logger.info("[adapter] calling stock_zh_a_spot_em()...")
    t0 = time.time()
    df = ak.stock_zh_a_spot_em()
    logger.info("[adapter] stock_zh_a_spot_em() returned %d rows in %.2fs", len(df), time.time() - t0)
    return _validate_and_normalize_df(df, SPOT_EM_COLUMNS, "stock_zh_a_spot_em")


def fetch_stock_hist(
    symbol: str,
    period: str = "daily",
    start_date: str = "",
    end_date: str = "",
    adjust: str = "qfq",
) -> pd.DataFrame:
    logger.info("[adapter] calling stock_zh_a_hist(%s, %s, %s, %s)...", symbol, period, start_date, end_date)
    t0 = time.time()
    kwargs = {"symbol": symbol, "period": period, "adjust": adjust}
    if start_date:
        kwargs["start_date"] = start_date
    if end_date:
        kwargs["end_date"] = end_date
    df = ak.stock_zh_a_hist(**kwargs)
    logger.info("[adapter] stock_zh_a_hist(%s) returned %d rows in %.2fs", symbol, len(df), time.time() - t0)
    return _validate_and_normalize_df(df, HIST_COLUMNS, "stock_zh_a_hist")


MINUTE_KLINE_COLUMNS = {"时间": "日期", "开盘": "开盘", "收盘": "收盘", "最高": "最高", "最低": "最低", "成交量": "成交量", "成交额": "成交额"}


def fetch_stock_hist_min(symbol: str, period: str = "5") -> pd.DataFrame:
    """获取分钟K线历史数据（东方财富）。

    Args:
        symbol: 股票代码，如 "600519"
        period: 分钟周期，"1", "5", "15", "30", "60"

    Returns:
        标准化的 DataFrame
    """
    logger.info("[adapter] calling stock_zh_a_hist_min_em(%s, %s)...", symbol, period)
    t0 = time.time()
    df = ak.stock_zh_a_hist_min_em(symbol=symbol, period=period)
    logger.info("[adapter] stock_zh_a_hist_min_em(%s) returned %d rows in %.2fs", symbol, len(df), time.time() - t0)
    # 列名标准化：时间 -> 日期
    df = df.rename(columns={"时间": "日期"})
    required = ["日期", "开盘", "收盘", "最高", "最低", "成交量", "成交额"]
    for col in required:
        if col not in df.columns:
            raise ColumnValidationError(f"stock_zh_a_hist_min_em missing column: {col}")
    return df[required]


def fetch_stock_info(symbol: str) -> pd.DataFrame:
    logger.info("[adapter] calling stock_individual_info_em(%s)...", symbol)
    t0 = time.time()
    df = ak.stock_individual_info_em(symbol=symbol)
    logger.info("[adapter] stock_individual_info_em(%s) returned %d rows in %.2fs", symbol, len(df), time.time() - t0)
    return _validate_and_normalize_df(
        df, INDIVIDUAL_INFO_COLUMNS, "stock_individual_info_em"
    )


def fetch_stock_news(symbol: str, since_time: str | None = None) -> pd.DataFrame:
    """
    Fetch all stock news from EastMoney search API.
    Loops through all pages until the API returns empty results.
    Safety cap at 50 pages (5000 items) to prevent infinite loops.
    """
    MAX_PAGES = 200
    logger.info("[adapter] calling stock_news for %s (since=%s)...", symbol, since_time or "all")
    t0 = time.time()

    all_rows = []
    url = "https://search-api-web.eastmoney.com/search/jsonp"
    headers = {
        "accept": "*/*",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "en,zh-CN;q=0.9,zh;q=0.8",
        "cache-control": "no-cache",
        "referer": f"https://so.eastmoney.com/news/s?keyword={symbol}",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }

    page = 1
    reached_existing = False
    while page <= MAX_PAGES and not reached_existing:
        items = []
        inner_param = {
            "uid": "",
            "keyword": symbol,
            "type": ["cmsArticleWebOld"],
            "client": "web",
            "clientType": "web",
            "clientVersion": "curr",
            "param": {
                "cmsArticleWebOld": {
                    "searchScope": "default",
                    "sort": "default",
                    "pageIndex": page,
                    "pageSize": 100,
                    "preTag": "<em>",
                    "postTag": "</em>",
                }
            },
        }
        params = {
            "cb": f"jQuery{int(time.time() * 1000)}",
            "param": json.dumps(inner_param, ensure_ascii=False),
            "_": str(int(time.time() * 1000)),
        }

        last_err = None
        for attempt in range(3):
            try:
                r = requests.get(url, params=params, headers=headers, timeout=30)
                data_text = r.text
                # Strip JSONP callback
                if "(" in data_text:
                    data_text = data_text[data_text.index("(") + 1 : data_text.rindex(")")]
                data_json = json.loads(data_text)
                items = data_json.get("result", {}).get("cmsArticleWebOld", [])
                if not items:
                    break  # No more results
                for item in items:
                    pub_time = item.get("date", "") or ""
                    if since_time and pub_time and pub_time <= since_time:
                        reached_existing = True
                        continue
                    all_rows.append({
                        "新闻标题": item.get("title", "").replace("<em>", "").replace("</em>", ""),
                        "新闻内容": (item.get("content", "") or "").replace("<em>", "").replace("</em>", ""),
                        "发布时间": pub_time,
                        "文章来源": item.get("mediaName", ""),
                        "新闻链接": f"http://finance.eastmoney.com/a/{item.get('code', '')}.html",
                        "关键词": symbol,
                    })
                break
            except Exception as e:
                last_err = e
                if attempt < 2:
                    time.sleep(1)

        if not items or reached_existing:
            break
        page += 1
        # Small delay between pages to be polite to the API
        if page > 1:
            time.sleep(0.3)

    if not all_rows:
        raise AKShareAdapterError(f"stock_news({symbol}) returned empty after {page} pages")

    df = pd.DataFrame(all_rows)
    col_order = ["关键词", "新闻标题", "新闻内容", "发布时间", "文章来源", "新闻链接"]
    df = df[col_order]
    logger.info("[adapter] stock_news(%s) returned %d rows (%.2fs)", symbol, len(df), time.time() - t0)
    return _validate_and_normalize_df(df, NEWS_COLUMNS, "stock_news")


def fetch_financial_report(symbol: str, report_type: str) -> pd.DataFrame | None:
    """
    Fetch financial report via stock_financial_report_sina.

    report_type: "profit" | "balance" | "cashflow"
    """
    type_map = {
        "profit": ("利润表", FINANCIAL_PROFIT_COLUMNS),
        "balance": ("资产负债表", FINANCIAL_BALANCE_COLUMNS),
        "cashflow": ("现金流量表", FINANCIAL_CASHFLOW_COLUMNS),
    }
    entry = type_map.get(report_type)
    if not entry:
        raise ValueError(f"Unknown report_type: {report_type}")

    sina_symbol, schema = entry
    try:
        logger.info("[adapter] calling stock_financial_report_sina(%s, %s)...", symbol, sina_symbol)
        t0 = time.time()
        df = ak.stock_financial_report_sina(stock=symbol, symbol=sina_symbol)
        logger.info("[adapter] stock_financial_report_sina(%s, %s) returned %d rows in %.2fs",
                    symbol, sina_symbol, len(df), time.time() - t0)
        return _validate_and_normalize_df(
            df, schema, f"stock_financial_report_sina({sina_symbol})"
        )
    except ColumnValidationError:
        raise
    except Exception as e:
        logger.warning(
            "stock_financial_report_sina(%s, %s) failed: %s",
            symbol, sina_symbol, e,
        )
        return None


def _em_stock_symbol(symbol: str) -> str:
    """Return EastMoney report symbol like SH600519 / SZ000001 / BJ830799."""
    if symbol.startswith(("SH", "SZ", "BJ")):
        return symbol
    if symbol.startswith("6"):
        return f"SH{symbol}"
    if symbol.startswith(("0", "3")):
        return f"SZ{symbol}"
    if symbol.startswith(("4", "8")):
        return f"BJ{symbol}"
    return f"SZ{symbol}"


def fetch_financial_report_em(symbol: str, report_type: str) -> pd.DataFrame | None:
    """
    Fetch full EastMoney financial reports.

    report_type: "income" | "balance" | "cashflow"
    """
    em_symbol = _em_stock_symbol(symbol)
    func_map = {
        "income": ak.stock_profit_sheet_by_report_em,
        "balance": ak.stock_balance_sheet_by_report_em,
        "cashflow": ak.stock_cash_flow_sheet_by_report_em,
    }
    func = func_map.get(report_type)
    if func is None:
        raise ValueError(f"Unknown report_type: {report_type}")

    try:
        logger.info("[adapter] calling %s(%s)...", func.__name__, em_symbol)
        t0 = time.time()
        df = func(symbol=em_symbol)
        if df is None or df.empty:
            logger.warning("%s(%s) returned empty", func.__name__, em_symbol)
            return None
        logger.info("[adapter] %s(%s) returned %d rows in %.2fs",
                    func.__name__, em_symbol, len(df), time.time() - t0)
        return df
    except Exception as e:
        logger.warning("%s(%s) failed: %s", func.__name__, em_symbol, e)
        return None


def fetch_financial_indicators(symbol: str, start_year: str = "2016") -> pd.DataFrame | None:
    """Fetch computed financial indicators via stock_financial_analysis_indicator."""
    try:
        logger.info("[adapter] calling stock_financial_analysis_indicator(%s, %s)...", symbol, start_year)
        t0 = time.time()
        df = ak.stock_financial_analysis_indicator(symbol=symbol, start_year=start_year)
        if df is None or df.empty:
            return None
        logger.info("[adapter] stock_financial_analysis_indicator(%s) returned %d rows in %.2fs",
                    symbol, len(df), time.time() - t0)
        return df
    except Exception as e:
        logger.warning("stock_financial_analysis_indicator(%s) failed: %s", symbol, e)
        return None


def fetch_dividend_data(symbol: str) -> pd.DataFrame | None:
    """Fetch per-stock dividend/split data.

    Prefer stock_fhps_detail_em(symbol), because stock_fhps_em is a date-wide
    market interface in AKShare 1.18.x, not a per-stock interface.
    """
    try:
        logger.info("[adapter] calling stock_fhps_detail_em(%s)...", symbol)
        t0 = time.time()
        df = ak.stock_fhps_detail_em(symbol=symbol)
        if df is None or df.empty:
            logger.info("[adapter] stock_fhps_detail_em(%s) returned empty", symbol)
            return None

        normalized = pd.DataFrame({
            "报告日": df.get("报告期"),
            "除权除息日": df.get("除权除息日"),
            "派息": pd.to_numeric(df.get("现金分红-现金分红比例"), errors="coerce").fillna(0) / 10,
            "送股": pd.to_numeric(df.get("送转股份-送股比例"), errors="coerce").fillna(0) / 10,
            "转增": pd.to_numeric(df.get("送转股份-转股比例"), errors="coerce").fillna(0) / 10,
            "股权登记日": df.get("股权登记日"),
            "进度": df.get("方案进度"),
            "分红说明": df.get("现金分红-现金分红比例描述"),
        })
        logger.info("[adapter] stock_fhps_detail_em(%s) returned %d rows in %.2fs",
                    symbol, len(df), time.time() - t0)
        return _validate_and_normalize_df(normalized, DIVIDEND_COLUMNS, f"stock_fhps_detail_em({symbol})")
    except Exception as e:
        logger.warning("stock_fhps_detail_em(%s) failed: %s", symbol, e)

    try:
        logger.info("[adapter] fallback calling stock_dividend_cninfo(%s)...", symbol)
        df = ak.stock_dividend_cninfo(symbol=symbol)
        if df is None or df.empty:
            return None
        normalized = pd.DataFrame({
            "报告日": df.get("报告时间"),
            "除权除息日": df.get("除权日"),
            "派息": pd.to_numeric(df.get("派息比例"), errors="coerce").fillna(0) / 10,
            "送股": pd.to_numeric(df.get("送股比例"), errors="coerce").fillna(0) / 10,
            "转增": pd.to_numeric(df.get("转增比例"), errors="coerce").fillna(0) / 10,
            "股权登记日": df.get("股权登记日"),
            "进度": df.get("分红类型"),
            "分红说明": df.get("实施方案分红说明"),
        })
        return _validate_and_normalize_df(normalized, DIVIDEND_COLUMNS, f"stock_dividend_cninfo({symbol})")
    except ColumnValidationError:
        raise
    except Exception as e:
        logger.warning("stock_dividend_cninfo(%s) failed: %s", symbol, e)
        return None


def fetch_stock_notices(symbol: str, start_date: str | None = None, end_date: str | None = None) -> pd.DataFrame | None:
    """Fetch company announcements via stock_zh_a_disclosure_report_cninfo (cninfo)."""
    try:
        end_date = end_date or datetime.now().strftime("%Y%m%d")
        start_date = start_date or "20200101"  # Fetch all available since 2020
        logger.info("[adapter] calling stock_zh_a_disclosure_report_cninfo(%s, %s, %s)...",
                    symbol, start_date, end_date)
        t0 = time.time()
        df = ak.stock_zh_a_disclosure_report_cninfo(
            symbol=symbol,
            market="沪深京",
            start_date=start_date,
            end_date=end_date,
        )
        if df is None or df.empty:
            logger.info("[adapter] stock_zh_a_disclosure_report_cninfo(%s) returned empty", symbol)
            return None
        logger.info("[adapter] stock_zh_a_disclosure_report_cninfo(%s) returned %d rows in %.2fs",
                    symbol, len(df), time.time() - t0)
        return _validate_and_normalize_df(df, NOTICE_COLUMNS, f"stock_zh_a_disclosure_report_cninfo({symbol})")
    except ColumnValidationError:
        raise
    except Exception as e:
        logger.warning("stock_zh_a_disclosure_report_cninfo(%s) failed: %s", symbol, e)
        return None


def fetch_stock_reports(symbol: str) -> pd.DataFrame | None:
    """Fetch research reports via stock_research_report_em."""
    try:
        logger.info("[adapter] calling stock_research_report_em(%s)...", symbol)
        t0 = time.time()
        df = ak.stock_research_report_em(symbol=symbol)
        if df is None or df.empty:
            logger.info("[adapter] stock_research_report_em(%s) returned empty", symbol)
            return None
        logger.info("[adapter] stock_research_report_em(%s) returned %d rows in %.2fs",
                    symbol, len(df), time.time() - t0)
        return _validate_and_normalize_df(df, REPORT_COLUMNS, f"stock_research_report_em({symbol})")
    except ColumnValidationError:
        raise
    except Exception as e:
        logger.warning("stock_research_report_em(%s) failed: %s", symbol, e)
        return None


def fetch_sector_fund_flow_rank(indicator: str = "今日") -> pd.DataFrame | None:
    """Fetch sector fund flow ranking from EastMoney."""
    try:
        logger.info("[adapter] calling stock_sector_fund_flow_rank(%s)...", indicator)
        t0 = time.time()
        df = ak.stock_sector_fund_flow_rank(indicator=indicator, sector_type="行业资金流")
        if df is None or df.empty:
            logger.warning("stock_sector_fund_flow_rank returned empty")
            return None
        logger.info("[adapter] stock_sector_fund_flow_rank returned %d rows in %.2fs", len(df), time.time() - t0)
        return df
    except Exception as e:
        logger.warning("stock_sector_fund_flow_rank failed: %s", e)
        return None


def fetch_board_cons(board_name: str) -> pd.DataFrame | None:
    """Fetch constituent stocks of an industry board."""
    try:
        logger.info("[adapter] calling stock_board_industry_cons_em(%s)...", board_name)
        t0 = time.time()
        df = ak.stock_board_industry_cons_em(symbol=board_name)
        if df is None or df.empty:
            logger.warning("stock_board_industry_cons_em(%s) returned empty", board_name)
            return None
        logger.info("[adapter] stock_board_industry_cons_em(%s) returned %d rows in %.2fs",
                    board_name, len(df), time.time() - t0)
        return df
    except Exception as e:
        logger.warning("stock_board_industry_cons_em(%s) failed: %s", board_name, e)
        return None


def fetch_bid_ask(symbol: str) -> dict | None:
    """Fetch bid/ask order book for a single stock (5 levels)."""
    try:
        logger.info("[adapter] calling stock_bid_ask_em(%s)...", symbol)
        t0 = time.time()
        df = ak.stock_bid_ask_em(symbol=symbol)
        if df is None or df.empty:
            logger.warning("stock_bid_ask_em(%s) returned empty", symbol)
            return None
        result = {}
        for _, row in df.iterrows():
            item = str(row.get("item", ""))
            value = row.get("value", 0)
            result[item] = value
        logger.info("[adapter] stock_bid_ask_em(%s) returned in %.2fs", symbol, time.time() - t0)
        return result
    except Exception as e:
        logger.warning("stock_bid_ask_em(%s) failed: %s", symbol, e)
        return None


def fetch_limit_up_pool(date: str) -> pd.DataFrame | None:
    """Fetch limit-up stock pool for a given date (YYYYMMDD)."""
    try:
        logger.info("[adapter] calling stock_zt_pool_em(%s)...", date)
        t0 = time.time()
        df = ak.stock_zt_pool_em(date=date)
        if df is None or df.empty:
            logger.warning("stock_zt_pool_em(%s) returned empty", date)
            return None
        logger.info("[adapter] stock_zt_pool_em(%s) returned %d rows in %.2fs", date, len(df), time.time() - t0)
        return df
    except Exception as e:
        logger.warning("stock_zt_pool_em(%s) failed: %s", date, e)
        return None
