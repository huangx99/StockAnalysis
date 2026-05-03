import logging
import time

import akshare as ak
import pandas as pd

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
    df = ak.stock_zh_a_hist(
        symbol=symbol,
        period=period,
        start_date=start_date,
        end_date=end_date,
        adjust=adjust,
    )
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
    if not hasattr(ak, "stock_news_em"):
        raise AKShareAdapterError("stock_news_em not available in this AKShare version")
    # Retry to handle transient TLS errors from curl_cffi
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            df = ak.stock_news_em(symbol=symbol)
            return _validate_and_normalize_df(df, NEWS_COLUMNS, "stock_news_em")
        except Exception as e:
            last_err = e
            if attempt < 2:
                import time
                time.sleep(1)
    raise AKShareAdapterError(f"stock_news_em({symbol}) failed after 3 attempts: {last_err}")


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
