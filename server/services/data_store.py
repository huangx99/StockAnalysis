import json
import logging
import os
import re
import time
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data" / "stocks"
DOWNLOAD_STATE_FILE = Path(__file__).parent.parent / "data" / "download_state.json"
DATA_SUMMARY_CACHE_FILE = Path(__file__).parent.parent / "data" / "data_stocks_snapshot.json"

_STOCKS_WITH_DATA_CACHE: list[dict] | None = None
_SYMBOL_DIR_RE = re.compile(r"^\d{6}$")

DATA_TYPES = [
    "profile", "kline_day", "kline_week", "kline_month",
    "financials", "news", "dividends", "notices", "reports",
    "financial_income_raw", "financial_balance_raw", "financial_cashflow_raw",
    "financial_indicator_raw", "financial_periods", "financial_summary",
    "ai_analysis",
]


def _stock_dir(symbol: str) -> Path:
    return DATA_DIR / symbol


def _is_stock_symbol_dir(path: Path) -> bool:
    return path.is_dir() and bool(_SYMBOL_DIR_RE.match(path.name))


def save_stock_data(symbol: str, data_type: str, data: list | dict) -> bool:
    try:
        d = _stock_dir(symbol)
        d.mkdir(parents=True, exist_ok=True)
        path = d / f"{data_type}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        logger.debug("[data_store] saved %s/%s (%d bytes)", symbol, data_type, path.stat().st_size)
        _update_stocks_with_data_cache(symbol)
        return True
    except PermissionError as e:
        logger.warning("[data_store] no permission to save %s/%s: %s", symbol, data_type, e)
        return False
    except Exception as e:
        logger.warning("[data_store] failed to save %s/%s: %s", symbol, data_type, e)
        return False


def load_stock_data(symbol: str, data_type: str) -> list | dict | None:
    path = _stock_dir(symbol) / f"{data_type}.json"
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("[data_store] failed to load %s/%s: %s", symbol, data_type, e)
        return None


def has_stock_data(symbol: str, data_type: str) -> bool:
    return (_stock_dir(symbol) / f"{data_type}.json").exists()


def delete_stock_data(symbol: str) -> bool:
    d = _stock_dir(symbol)
    if not d.exists():
        return False
    import shutil
    shutil.rmtree(d)
    _remove_from_stocks_with_data_cache(symbol)
    logger.info("[data_store] deleted data for %s", symbol)
    return True


def get_stock_data_summary(symbol: str) -> dict:
    d = _stock_dir(symbol)
    if not d.exists():
        return {"symbol": symbol, "exists": False, "dataTypes": {}, "totalSize": 0}

    data_types = {}
    total_size = 0
    for dt in DATA_TYPES:
        path = d / f"{dt}.json"
        if path.exists():
            stat = path.stat()
            data_types[dt] = {
                "exists": True,
                "size": stat.st_size,
                "updatedAt": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            }
            total_size += stat.st_size
        else:
            data_types[dt] = {"exists": False, "size": 0, "updatedAt": None}

    return {
        "symbol": symbol,
        "exists": True,
        "dataTypes": data_types,
        "totalSize": total_size,
    }


def _load_stocks_with_data_cache_file() -> list[dict] | None:
    if not DATA_SUMMARY_CACHE_FILE.exists():
        return None
    try:
        with open(DATA_SUMMARY_CACHE_FILE, "r", encoding="utf-8") as f:
            payload = json.load(f)
        items = payload.get("items") if isinstance(payload, dict) else None
        if isinstance(items, list):
            return items
    except Exception as e:
        logger.warning("[data_store] failed to load stock summary cache: %s", e)
    return None


def _save_stocks_with_data_cache_file(items: list[dict]) -> None:
    try:
        DATA_SUMMARY_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(DATA_SUMMARY_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "items": items,
            }, f, ensure_ascii=False)
    except Exception as e:
        logger.warning("[data_store] failed to save stock summary cache: %s", e)


def _build_stocks_with_data_cache() -> list[dict]:
    if not DATA_DIR.exists():
        _save_stocks_with_data_cache_file([])
        return []

    results = []
    for d in sorted(DATA_DIR.iterdir()):
        if not _is_stock_symbol_dir(d):
            continue
        symbol = d.name
        summary = get_stock_data_summary(symbol)
        if summary["exists"]:
            results.append(summary)
    _save_stocks_with_data_cache_file(results)
    return results


def rebuild_stocks_with_data_cache() -> list[dict]:
    global _STOCKS_WITH_DATA_CACHE
    _STOCKS_WITH_DATA_CACHE = _build_stocks_with_data_cache()
    return [dict(item) for item in _STOCKS_WITH_DATA_CACHE]


def _update_stocks_with_data_cache(symbol: str) -> None:
    global _STOCKS_WITH_DATA_CACHE
    if _STOCKS_WITH_DATA_CACHE is None:
        _STOCKS_WITH_DATA_CACHE = _load_stocks_with_data_cache_file()
    if _STOCKS_WITH_DATA_CACHE is None:
        return
    summary = get_stock_data_summary(symbol)
    next_items = [item for item in _STOCKS_WITH_DATA_CACHE if item.get("symbol") != symbol]
    if summary.get("exists"):
        next_items.append(summary)
    next_items.sort(key=lambda item: item.get("symbol", ""))
    _STOCKS_WITH_DATA_CACHE = next_items
    _save_stocks_with_data_cache_file(next_items)


def _remove_from_stocks_with_data_cache(symbol: str) -> None:
    global _STOCKS_WITH_DATA_CACHE
    if _STOCKS_WITH_DATA_CACHE is None:
        _STOCKS_WITH_DATA_CACHE = _load_stocks_with_data_cache_file()
    if _STOCKS_WITH_DATA_CACHE is None:
        return
    _STOCKS_WITH_DATA_CACHE = [item for item in _STOCKS_WITH_DATA_CACHE if item.get("symbol") != symbol]
    _save_stocks_with_data_cache_file(_STOCKS_WITH_DATA_CACHE)


def list_stocks_with_data() -> list[dict]:
    global _STOCKS_WITH_DATA_CACHE
    if _STOCKS_WITH_DATA_CACHE is not None:
        return [dict(item) for item in _STOCKS_WITH_DATA_CACHE]

    cached = _load_stocks_with_data_cache_file()
    if cached is not None:
        _STOCKS_WITH_DATA_CACHE = cached
        return [dict(item) for item in cached]

    _STOCKS_WITH_DATA_CACHE = _build_stocks_with_data_cache()
    return [dict(item) for item in _STOCKS_WITH_DATA_CACHE]


def list_stock_symbols_with_data() -> list[str]:
    if not DATA_DIR.exists():
        return []
    return [d.name for d in sorted(DATA_DIR.iterdir()) if _is_stock_symbol_dir(d)]


def get_last_kline_date(symbol: str, period: str = "day") -> str | None:
    """Return the last date string from local kline data, or None if no data."""
    data = load_stock_data(symbol, f"kline_{period}")
    if not data or not isinstance(data, list) or len(data) == 0:
        return None
    try:
        return data[-1].get("date")
    except (KeyError, IndexError, TypeError):
        return None


def save_download_state(state: dict) -> None:
    DOWNLOAD_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DOWNLOAD_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def load_download_state() -> dict | None:
    if not DOWNLOAD_STATE_FILE.exists():
        return None
    try:
        with open(DOWNLOAD_STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("[data_store] failed to load download state: %s", e)
        return None
