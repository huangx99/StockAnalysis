import json
import logging
import time

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


def fetch_stock_info(symbol: str) -> pd.DataFrame:
    logger.info("[adapter] calling stock_individual_info_em(%s)...", symbol)
    t0 = time.time()
    df = ak.stock_individual_info_em(symbol=symbol)
    logger.info("[adapter] stock_individual_info_em(%s) returned %d rows in %.2fs", symbol, len(df), time.time() - t0)
    return _validate_and_normalize_df(
        df, INDIVIDUAL_INFO_COLUMNS, "stock_individual_info_em"
    )


def fetch_stock_news(symbol: str) -> pd.DataFrame:
    """
    Fetch all stock news from EastMoney search API.
    Loops through all pages until the API returns empty results.
    Safety cap at 50 pages (5000 items) to prevent infinite loops.
    """
    MAX_PAGES = 50
    logger.info("[adapter] calling stock_news for %s (all pages)...", symbol)
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
    while page <= MAX_PAGES:
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
                    all_rows.append({
                        "新闻标题": item.get("title", "").replace("<em>", "").replace("</em>", ""),
                        "新闻内容": (item.get("content", "") or "").replace("<em>", "").replace("</em>", ""),
                        "发布时间": item.get("date", ""),
                        "文章来源": item.get("mediaName", ""),
                        "新闻链接": f"http://finance.eastmoney.com/a/{item.get('code', '')}.html",
                        "关键词": symbol,
                    })
                break
            except Exception as e:
                last_err = e
                if attempt < 2:
                    time.sleep(1)

        if not items:
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


def fetch_dividend_data(symbol: str) -> pd.DataFrame | None:
    """Fetch dividend/split data via stock_fhps_em."""
    try:
        logger.info("[adapter] calling stock_fhps_em(%s)...", symbol)
        t0 = time.time()
        df = ak.stock_fhps_em(symbol=symbol)
        logger.info("[adapter] stock_fhps_em(%s) returned %d rows in %.2fs",
                    symbol, len(df), time.time() - t0)
        return _validate_and_normalize_df(df, DIVIDEND_COLUMNS, f"stock_fhps_em({symbol})")
    except ColumnValidationError:
        raise
    except Exception as e:
        logger.warning("stock_fhps_em(%s) failed: %s", symbol, e)
        return None
