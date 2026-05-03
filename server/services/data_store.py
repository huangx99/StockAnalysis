import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data" / "stocks"
DOWNLOAD_STATE_FILE = Path(__file__).parent.parent / "data" / "download_state.json"

DATA_TYPES = [
    "profile", "kline_day", "kline_week", "kline_month",
    "financials", "news", "dividends", "notices", "reports",
]


def _stock_dir(symbol: str) -> Path:
    return DATA_DIR / symbol


def save_stock_data(symbol: str, data_type: str, data: list | dict) -> None:
    d = _stock_dir(symbol)
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{data_type}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    logger.debug("[data_store] saved %s/%s (%d bytes)", symbol, data_type, path.stat().st_size)


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


def list_stocks_with_data() -> list[dict]:
    if not DATA_DIR.exists():
        return []

    results = []
    for d in sorted(DATA_DIR.iterdir()):
        if not d.is_dir():
            continue
        symbol = d.name
        summary = get_stock_data_summary(symbol)
        if summary["exists"]:
            results.append(summary)
    return results


def list_stock_symbols_with_data() -> list[str]:
    if not DATA_DIR.exists():
        return []
    return [d.name for d in sorted(DATA_DIR.iterdir()) if d.is_dir()]


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
