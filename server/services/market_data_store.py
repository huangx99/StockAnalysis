import json
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MARKET_DATA_DIR = Path(__file__).parent.parent / "data" / "market"
MARKET_DOWNLOAD_STATE_FILE = Path(__file__).parent.parent / "data" / "market_download_state.json"

MARKET_DATA_TYPES = [
    "overview",
    "market_indices",
    "breadth",
    "style_rotation",
    "north_money",
    "sector_rank",
    "sector_fund_flow",
    "limit_up_pool",
    "limit_down_pool",
    "sentiment",
    "quality_report",
]


def _trade_date_dir(trade_date: str) -> Path:
    return MARKET_DATA_DIR / trade_date


def _clean_json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return value
    if hasattr(value, "item"):
        try:
            return _clean_json_value(value.item())
        except Exception:
            pass
    if isinstance(value, dict):
        return {str(k): _clean_json_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean_json_value(v) for v in value]
    return value


def save_market_data(trade_date: str, data_type: str, data: list | dict) -> None:
    try:
        directory = _trade_date_dir(trade_date)
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{data_type}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_clean_json_value(data), f, ensure_ascii=False)
        logger.debug("[market_store] saved %s/%s (%d bytes)", trade_date, data_type, path.stat().st_size)
    except Exception as e:
        logger.warning("[market_store] failed to save %s/%s: %s", trade_date, data_type, e)


def load_market_data(trade_date: str, data_type: str) -> list | dict | None:
    path = _trade_date_dir(trade_date) / f"{data_type}.json"
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("[market_store] failed to load %s/%s: %s", trade_date, data_type, e)
        return None


def delete_market_data(trade_date: str) -> bool:
    directory = _trade_date_dir(trade_date)
    if not directory.exists():
        return False
    import shutil
    shutil.rmtree(directory)
    logger.info("[market_store] deleted data for %s", trade_date)
    return True


def get_market_data_summary(trade_date: str) -> dict:
    directory = _trade_date_dir(trade_date)
    if not directory.exists():
        return {"tradeDate": trade_date, "exists": False, "dataTypes": {}, "totalSize": 0}

    data_types = {}
    total_size = 0
    for data_type in MARKET_DATA_TYPES:
        path = directory / f"{data_type}.json"
        if path.exists():
            stat = path.stat()
            data_types[data_type] = {
                "exists": True,
                "size": stat.st_size,
                "updatedAt": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            }
            total_size += stat.st_size
        else:
            data_types[data_type] = {"exists": False, "size": 0, "updatedAt": None}

    overview = load_market_data(trade_date, "overview")
    sentiment = load_market_data(trade_date, "sentiment")
    market_indices = load_market_data(trade_date, "market_indices")
    breadth = load_market_data(trade_date, "breadth")
    style_rotation = load_market_data(trade_date, "style_rotation")
    quality_report = load_market_data(trade_date, "quality_report")
    return {
        "tradeDate": trade_date,
        "exists": True,
        "dataTypes": data_types,
        "totalSize": total_size,
        "overview": overview if isinstance(overview, dict) else None,
        "sentiment": sentiment if isinstance(sentiment, dict) else None,
        "marketIndices": market_indices if isinstance(market_indices, dict) else None,
        "breadth": breadth if isinstance(breadth, dict) else None,
        "styleRotation": style_rotation if isinstance(style_rotation, dict) else None,
        "qualityReport": quality_report if isinstance(quality_report, dict) else None,
    }


def list_market_snapshots() -> list[dict]:
    if not MARKET_DATA_DIR.exists():
        return []
    results = []
    for directory in sorted(MARKET_DATA_DIR.iterdir(), reverse=True):
        if directory.is_dir():
            summary = get_market_data_summary(directory.name)
            if summary["exists"]:
                results.append(summary)
    return results


def get_latest_trade_date() -> str | None:
    snapshots = list_market_snapshots()
    return snapshots[0]["tradeDate"] if snapshots else None


def save_market_download_state(state: dict) -> None:
    MARKET_DOWNLOAD_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(MARKET_DOWNLOAD_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(_clean_json_value(state), f, ensure_ascii=False, indent=2)


def load_market_download_state() -> dict | None:
    if not MARKET_DOWNLOAD_STATE_FILE.exists():
        return None
    try:
        with open(MARKET_DOWNLOAD_STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("[market_store] failed to load market download state: %s", e)
        return None
