import json
import math
from collections import Counter
from functools import lru_cache
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Query

from models.system import SystemStatus, AIConfigRequest, AIConfigResponse
from services import ai_service
from services import data_store
from services import batch_downloader
from services import market_data_store
from services import market_downloader

router = APIRouter(prefix="/api", tags=["system"])

LOCAL_DATA_TYPE_LABELS = {
    "profile": "基本信息",
    "kline_day": "日K线",
    "kline_week": "周K线",
    "kline_month": "月K线",
    "financials": "财务数据",
    "news": "新闻公告",
    "dividends": "分红",
    "notices": "公告",
    "reports": "研报",
}
REQUIRED_LOCAL_DATA_TYPES = tuple(LOCAL_DATA_TYPE_LABELS.keys())
INDUSTRY_SNAPSHOT_FILE = Path(__file__).parent.parent / "data" / "industry_snapshot.json"


def _json_safe(value):
    if isinstance(value, float):
        return value if math.isfinite(value) else 0
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def _get_missing_data_types(stock: dict) -> list[str]:
    data_types = stock.get("dataTypes") or {}
    return [
        data_type
        for data_type in REQUIRED_LOCAL_DATA_TYPES
        if not (data_types.get(data_type) or {}).get("exists")
    ]


@lru_cache(maxsize=1)
def _load_stock_name_map() -> dict[str, str]:
    stock_list_path = Path(__file__).parent.parent / "data" / "stock_list.json"
    name_map: dict[str, str] = {}
    if stock_list_path.exists():
        try:
            with open(stock_list_path, "r", encoding="utf-8") as f:
                for item in json.load(f):
                    code = str(item.get("code", ""))
                    name = str(item.get("name", ""))
                    if code:
                        name_map[code] = name
        except Exception:
            pass
    return name_map


@router.get("/system/status", response_model=SystemStatus)
async def status():
    import akshare as ak

    ak_status = "online"
    try:
        ak.stock_zh_a_spot_em()
    except Exception:
        ak_status = "offline"

    from config import settings

    ai_status = "online"
    if settings.ai_provider == "claude" and not settings.anthropic_api_key:
        ai_status = "offline"
    elif settings.ai_provider == "openai" and not settings.openai_api_key:
        ai_status = "offline"
    elif settings.ai_provider == "custom" and not settings.custom_base_url:
        ai_status = "offline"

    return SystemStatus(
        akshare=ak_status,
        aiService=ai_status,
        dataSource="AKShare",
        lastUpdate=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )


@router.get("/system/ai-config", response_model=AIConfigResponse)
async def get_ai_config():
    return ai_service.get_ai_config_status()


@router.put("/system/ai-config", response_model=AIConfigResponse)
async def update_ai_config(config: AIConfigRequest):
    ai_service.save_ai_config(
        provider=config.provider,
        api_key=config.apiKey,
        model=config.model,
        base_url=config.baseUrl,
    )
    return ai_service.get_ai_config_status()


@router.get("/system/data-status")
async def data_status():
    return batch_downloader.get_download_status()


@router.get("/system/data/single-status")
async def single_download_status():
    return batch_downloader.get_single_download_status()


@router.post("/system/data-reset")
async def data_reset():
    data_store.save_download_state({
        "status": "idle",
        "total": 0,
        "completed": 0,
        "failed": [],
        "lastSymbol": None,
        "startedAt": None,
        "updatedAt": None,
        "dataTypes": [],
        "logs": [],
    })
    return {"status": "ok"}


def _format_data_stocks_response(
    all_stocks: list[dict],
    page: int,
    pageSize: int,
    q: str,
    missingOnly: bool = False,
):
    name_map = _load_stock_name_map()

    for s in all_stocks:
        symbol = str(s.get("symbol") or "")
        profile = _profile_for_symbol(symbol, name_map) if symbol else {}
        s["name"] = profile.get("name") or name_map.get(symbol, "")
        s["industry"] = profile.get("industry") or "未知"
        missing_data_types = _get_missing_data_types(s)
        s["missingDataTypes"] = missing_data_types
        s["missingCount"] = len(missing_data_types)

    if missingOnly:
        all_stocks = [s for s in all_stocks if s.get("missingCount", 0) > 0]

    if q:
        ql = q.lower()
        all_stocks = [s for s in all_stocks if ql in s["symbol"].lower() or ql in s["name"].lower()]

    total = len(all_stocks)
    start = (page - 1) * pageSize
    end = start + pageSize

    return {
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "items": all_stocks[start:end],
    }


def _profile_for_symbol(symbol: str, name_map: dict[str, str]) -> dict:
    profile = data_store.load_stock_data(symbol, "profile")
    if not isinstance(profile, dict):
        return {
            "symbol": symbol,
            "name": name_map.get(symbol, ""),
            "industry": "未知",
            "currentPrice": 0,
            "changePercent": 0,
            "marketCap": 0,
            "pe": 0,
            "pb": 0,
        }
    return {
        "symbol": symbol,
        "name": str(profile.get("name") or name_map.get(symbol, "")),
        "industry": str(profile.get("industry") or "未知"),
        "currentPrice": profile.get("currentPrice") or 0,
        "changePercent": profile.get("changePercent") or 0,
        "marketCap": profile.get("marketCap") or 0,
        "pe": profile.get("pe") or 0,
        "pb": profile.get("pb") or 0,
    }


def _stock_has_financial_periods(symbol: str) -> bool:
    periods = data_store.load_stock_data(symbol, "financial_periods")
    return isinstance(periods, list) and len(periods) > 0


def _build_industry_snapshot() -> dict:
    name_map = _load_stock_name_map()
    industries: dict[str, dict] = {}
    stocks: list[dict] = []
    for item in data_store.list_stocks_with_data():
        symbol = str(item.get("symbol") or "")
        if not symbol:
            continue
        profile = _profile_for_symbol(symbol, name_map)
        industry = str(profile.get("industry") or "未知")
        scorable = _stock_has_financial_periods(symbol)
        stocks.append({
            "symbol": symbol,
            "name": profile.get("name") or name_map.get(symbol, ""),
            "industry": industry,
            "scorable": scorable,
            "profile": profile,
        })
        if not industry or industry == "未知":
            continue
        row = industries.setdefault(industry, {"industry": industry, "count": 0, "scorableCount": 0, "symbols": []})
        row["count"] += 1
        if scorable:
            row["scorableCount"] += 1
        row["symbols"].append(symbol)
    industry_items = sorted(
        industries.values(),
        key=lambda row: (row["scorableCount"], row["count"], row["industry"]),
        reverse=True,
    )
    return {
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "items": industry_items,
        "stocks": stocks,
    }


def _load_industry_snapshot() -> dict | None:
    if not INDUSTRY_SNAPSHOT_FILE.exists():
        return None
    try:
        with open(INDUSTRY_SNAPSHOT_FILE, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(payload, dict) and isinstance(payload.get("items"), list) and isinstance(payload.get("stocks"), list):
            return payload
    except Exception:
        pass
    return None


def _save_industry_snapshot(snapshot: dict) -> None:
    INDUSTRY_SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(INDUSTRY_SNAPSHOT_FILE, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False)


def _get_or_build_industry_snapshot(force: bool = False) -> dict:
    if not force:
        snapshot = _load_industry_snapshot()
        if snapshot is not None:
            return snapshot
    snapshot = _build_industry_snapshot()
    _save_industry_snapshot(snapshot)
    return snapshot


@router.get("/industry/industries")
async def industry_list():
    snapshot = _get_or_build_industry_snapshot()
    return {
        "updatedAt": snapshot.get("updatedAt"),
        "items": snapshot.get("items", []),
    }


@router.post("/industry/industries/rebuild")
async def rebuild_industry_list():
    snapshot = _get_or_build_industry_snapshot(force=True)
    return {
        "updatedAt": snapshot.get("updatedAt"),
        "items": snapshot.get("items", []),
    }


@router.get("/industry/compare")
async def industry_compare(
    industry: str = Query("", description="Industry name"),
    period: str = Query("annual", pattern="^(annual|quarter)$"),
    q: str = Query("", description="Search by symbol or name"),
    completeOnly: bool = Query(False, description="Only include stocks with financial periods"),
    limit: int = Query(300, ge=1, le=1000),
):
    snapshot = _get_or_build_industry_snapshot()
    peers = []
    ql = q.lower().strip()
    for stock in snapshot.get("stocks", []):
        symbol = str(stock.get("symbol") or "")
        profile = stock.get("profile") if isinstance(stock.get("profile"), dict) else {}
        stock_industry = str(stock.get("industry") or profile.get("industry") or "未知")
        name = str(stock.get("name") or profile.get("name") or "")
        if industry and stock_industry != industry:
            continue
        if ql and ql not in symbol.lower() and ql not in name.lower():
            continue
        if completeOnly and not stock.get("scorable"):
            continue
        raw_periods = data_store.load_stock_data(symbol, "financial_periods")
        periods = raw_periods if isinstance(raw_periods, list) else []
        if period == "annual":
            periods = [p for p in periods if p.get("reportQuarter") == "FY"]
        periods = sorted(periods, key=lambda p: str(p.get("reportDate") or ""), reverse=True)[:16]
        if completeOnly and not periods:
            continue
        peers.append({
            "symbol": symbol,
            "name": name,
            "industry": stock_industry,
            "profile": _json_safe(profile or _profile_for_symbol(symbol, _load_stock_name_map())),
            "periods": _json_safe(periods),
            "hasFinancialData": len(periods) > 0,
        })
        if len(peers) >= limit:
            break
    return _json_safe({
        "industry": industry,
        "period": period,
        "updatedAt": snapshot.get("updatedAt"),
        "total": len(peers),
        "items": peers,
    })


@router.get("/system/data-stocks")
async def data_stocks(
    page: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=200),
    q: str = Query("", description="Search by symbol or name"),
    missingOnly: bool = Query(False, description="Only return stocks with missing local data"),
):
    return _format_data_stocks_response(data_store.list_stocks_with_data(), page, pageSize, q, missingOnly)


@router.post("/system/data-stocks/rebuild")
async def rebuild_data_stocks(
    page: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=200),
    q: str = Query("", description="Search by symbol or name"),
    missingOnly: bool = Query(False, description="Only return stocks with missing local data"),
):
    return _format_data_stocks_response(data_store.rebuild_stocks_with_data_cache(), page, pageSize, q, missingOnly)


@router.post("/system/data-download")
async def start_download():
    return await batch_downloader.start_download()


@router.post("/system/data-stop")
async def stop_download():
    return await batch_downloader.stop_download()


@router.post("/system/data/refresh/{symbol}")
async def refresh_stock(symbol: str):
    return await batch_downloader.refresh_single(symbol)


@router.post("/system/data/refresh-missing/{symbol}")
async def refresh_missing_stock(symbol: str):
    return await batch_downloader.refresh_missing(symbol)


@router.post("/system/data/download/{symbol}")
async def download_stock(symbol: str):
    """Download all data for a single stock. If not in stock list, try anyway."""
    stock_list_path = Path(__file__).parent.parent / "data" / "stock_list.json"
    name = ""
    if stock_list_path.exists():
        try:
            with open(stock_list_path, "r", encoding="utf-8") as f:
                for item in json.load(f):
                    if item["code"] == symbol:
                        name = item["name"]
                        break
        except Exception:
            pass
    try:
        stats = await batch_downloader._download_single_with_progress(symbol, name, list(data_store.DATA_TYPES))
        return {"status": "ok", "symbol": symbol, "name": name, "stats": stats}
    except Exception as e:
        return {"status": "error", "symbol": symbol, "message": str(e)}


@router.post("/system/data-refresh-all")
async def refresh_all():
    return await batch_downloader.refresh_all_existing()


@router.delete("/system/data/{symbol}")
async def delete_stock(symbol: str):
    deleted = data_store.delete_stock_data(symbol)
    if deleted:
        return {"status": "ok", "message": f"Deleted data for {symbol}"}
    return {"status": "not_found", "message": f"No data found for {symbol}"}


@router.get("/system/market-data/status")
async def market_data_status():
    return market_downloader.get_market_download_status()


@router.get("/system/market-data/trade-dates")
async def market_trade_dates(
    startDate: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    endDate: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    dates = market_downloader.get_trade_dates(startDate, endDate)
    return {"items": dates}


@router.post("/system/market-data/download")
async def start_market_data_download(
    tradeDate: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    startDate: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    endDate: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    dates: list[str] | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    return await market_downloader.start_market_download(tradeDate, startDate, endDate, dates)


@router.post("/system/market-data/pause")
async def pause_market_data_download():
    return await market_downloader.pause_market_download()


@router.post("/system/market-data/resume")
async def resume_market_data_download():
    return await market_downloader.resume_market_download()


@router.post("/system/market-data/cancel")
async def cancel_market_data_download():
    return await market_downloader.cancel_market_download()


@router.post("/system/market-data/reset")
async def reset_market_data_status():
    return market_downloader.reset_market_download_status()


@router.get("/system/market-data/snapshots")
async def market_data_snapshots():
    return {"items": market_data_store.list_market_snapshots()}


@router.get("/system/market-data/latest")
async def latest_market_data():
    trade_date = market_data_store.get_latest_trade_date()
    if not trade_date:
        return {"tradeDate": None, "overview": None, "sentiment": None}
    return market_data_store.get_market_data_summary(trade_date)


@router.get("/system/market-data/{trade_date}/{data_type}")
async def market_data_detail(trade_date: str, data_type: str):
    if data_type not in market_data_store.MARKET_DATA_TYPES:
        return {"tradeDate": trade_date, "dataType": data_type, "data": None, "error": "Invalid data type"}
    return {
        "tradeDate": trade_date,
        "dataType": data_type,
        "data": market_data_store.load_market_data(trade_date, data_type),
    }


@router.delete("/system/market-data/{trade_date}")
async def delete_market_data(trade_date: str):
    deleted = market_data_store.delete_market_data(trade_date)
    if deleted:
        return {"status": "ok", "message": f"Deleted market data for {trade_date}"}
    return {"status": "not_found", "message": f"No market data found for {trade_date}"}


@router.get("/system/industries")
async def list_industries():
    """List industries from local profile data to avoid slow AKShare calls on page load."""
    counts: Counter[str] = Counter()
    for symbol in data_store.list_stock_symbols_with_data():
        profile = data_store.load_stock_data(symbol, "profile")
        if isinstance(profile, dict):
            industry = str(profile.get("industry") or "").strip()
            if industry and industry != "未知":
                counts[industry] += 1

    items = [
        {"name": name, "code": "", "count": count}
        for name, count in counts.most_common()
    ]
    return {"items": items}


@router.get("/system/industry/{industry_name}/stocks")
async def industry_stocks(industry_name: str):
    """List stocks in a given industry."""
    import asyncio
    import akshare as ak

    def _fetch():
        df = ak.stock_board_industry_cons_em(symbol=industry_name)
        results = []
        for _, row in df.iterrows():
            code = str(row.get("代码", ""))
            results.append({"code": code, "name": str(row.get("名称", ""))})
        return results

    try:
        stocks = await asyncio.to_thread(_fetch)
        return {"industry": industry_name, "items": stocks}
    except Exception as e:
        return {"industry": industry_name, "items": [], "error": str(e)}
