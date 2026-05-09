import json
import math
from collections import Counter
from functools import lru_cache
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, Query

from models.auth import UserPublic
from models.system import SystemStatus, AIConfigRequest, AIConfigResponse
from services import ai_service
from services import auth_store
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


@router.get("/system/data-sources")
async def data_sources_status():
    """Get health status of all registered data sources."""
    from services.data_sources import get_registry, get_pool_manager

    registry = get_registry()
    pool_manager = get_pool_manager()

    return {
        "sources": registry.list_sources(),
        "thread_pools": pool_manager.list_pools(),
    }


@router.post("/system/data-sources/{source_name}/reset-health")
async def reset_source_health(source_name: str):
    """Reset health tracking for a specific data source."""
    from services.data_sources import get_registry

    registry = get_registry()
    registry.reset_health(source_name)
    return {"status": "ok", "source": source_name}


@router.get("/system/ai-config", response_model=AIConfigResponse)
async def get_ai_config(_: UserPublic = Depends(auth_store.require_admin)):
    return ai_service.get_ai_config_status()


@router.put("/system/ai-config", response_model=AIConfigResponse)
async def update_ai_config(config: AIConfigRequest, _: UserPublic = Depends(auth_store.require_admin)):
    ai_service.save_ai_config(
        provider=config.provider,
        api_key=config.apiKey,
        model=config.model,
        base_url=config.baseUrl,
    )
    return ai_service.get_ai_config_status()


@router.get("/system/data-status")
async def data_status(_: UserPublic = Depends(auth_store.require_admin)):
    return batch_downloader.get_download_status()


@router.get("/system/data/single-status")
async def single_download_status(_: UserPublic = Depends(auth_store.require_admin)):
    return batch_downloader.get_single_download_status()


@router.post("/system/data-reset")
async def data_reset(_: UserPublic = Depends(auth_store.require_admin)):
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
async def rebuild_industry_list(_: UserPublic = Depends(auth_store.require_admin)):
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
    _: UserPublic = Depends(auth_store.require_admin),
):
    return _format_data_stocks_response(data_store.list_stocks_with_data(), page, pageSize, q, missingOnly)


@router.post("/system/data-stocks/rebuild")
async def rebuild_data_stocks(
    page: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=200),
    q: str = Query("", description="Search by symbol or name"),
    missingOnly: bool = Query(False, description="Only return stocks with missing local data"),
    _: UserPublic = Depends(auth_store.require_admin),
):
    return _format_data_stocks_response(data_store.rebuild_stocks_with_data_cache(), page, pageSize, q, missingOnly)


@router.post("/system/data-download")
async def start_download(_: UserPublic = Depends(auth_store.require_admin)):
    return await batch_downloader.start_download()


@router.post("/system/data-stop")
async def stop_download(_: UserPublic = Depends(auth_store.require_admin)):
    return await batch_downloader.stop_download()


@router.post("/system/data/refresh/{symbol}")
async def refresh_stock(symbol: str, _: UserPublic = Depends(auth_store.get_current_user)):
    return await batch_downloader.refresh_single(symbol)


@router.post("/system/data/refresh-missing/{symbol}")
async def refresh_missing_stock(symbol: str, _: UserPublic = Depends(auth_store.require_admin)):
    return await batch_downloader.refresh_missing(symbol)


@router.post("/system/data/download/{symbol}")
async def download_stock(
    symbol: str,
    dataTypes: list[str] | None = Query(None),
    _: UserPublic = Depends(auth_store.require_admin),
):
    """Download selected data for a single stock. If not in stock list, try anyway."""
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
    requested_types = dataTypes or list(data_store.DATA_TYPES)
    allowed_types = set(data_store.DATA_TYPES)
    invalid_types = [item for item in requested_types if item not in allowed_types]
    if invalid_types:
        return {"status": "error", "symbol": symbol, "message": f"不支持的数据类型: {', '.join(invalid_types)}"}
    try:
        stats = await batch_downloader._download_single_with_progress(symbol, name, requested_types)
        return {"status": "ok", "symbol": symbol, "name": name, "stats": stats}
    except Exception as e:
        return {"status": "error", "symbol": symbol, "message": str(e)}


@router.post("/system/data-refresh-all")
async def refresh_all(_: UserPublic = Depends(auth_store.require_admin)):
    return await batch_downloader.refresh_all_existing()


@router.delete("/system/data/{symbol}")
async def delete_stock(symbol: str, _: UserPublic = Depends(auth_store.require_admin)):
    deleted = data_store.delete_stock_data(symbol)
    if deleted:
        return {"status": "ok", "message": f"Deleted data for {symbol}"}
    return {"status": "not_found", "message": f"No data found for {symbol}"}


@router.get("/system/market-data/status")
async def market_data_status(_: UserPublic = Depends(auth_store.require_admin)):
    return market_downloader.get_market_download_status()


@router.get("/system/market-data/trade-dates")
async def market_trade_dates(
    startDate: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    endDate: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _: UserPublic = Depends(auth_store.require_admin),
):
    dates = market_downloader.get_trade_dates(startDate, endDate)
    return {"items": dates}


@router.post("/system/market-data/download")
async def start_market_data_download(
    tradeDate: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    startDate: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    endDate: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    dates: list[str] | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _: UserPublic = Depends(auth_store.require_admin),
):
    return await market_downloader.start_market_download(tradeDate, startDate, endDate, dates)


@router.post("/system/market-data/pause")
async def pause_market_data_download(_: UserPublic = Depends(auth_store.require_admin)):
    return await market_downloader.pause_market_download()


@router.post("/system/market-data/resume")
async def resume_market_data_download(_: UserPublic = Depends(auth_store.require_admin)):
    return await market_downloader.resume_market_download()


@router.post("/system/market-data/cancel")
async def cancel_market_data_download(_: UserPublic = Depends(auth_store.require_admin)):
    return await market_downloader.cancel_market_download()


@router.post("/system/market-data/reset")
async def reset_market_data_status(_: UserPublic = Depends(auth_store.require_admin)):
    return market_downloader.reset_market_download_status()


@router.get("/system/market-data/snapshots")
async def market_data_snapshots(_: UserPublic = Depends(auth_store.require_admin)):
    return {"items": market_data_store.list_market_snapshots()}


@router.get("/system/market-data/latest")
async def latest_market_data(_: UserPublic = Depends(auth_store.require_admin)):
    trade_date = market_data_store.get_latest_trade_date()
    if not trade_date:
        return {"tradeDate": None, "overview": None, "sentiment": None}
    return market_data_store.get_market_data_summary(trade_date)


@router.get("/system/market-data/{trade_date}/{data_type}")
async def market_data_detail(trade_date: str, data_type: str, _: UserPublic = Depends(auth_store.require_admin)):
    if data_type not in market_data_store.MARKET_DATA_TYPES:
        return {"tradeDate": trade_date, "dataType": data_type, "data": None, "error": "Invalid data type"}
    return {
        "tradeDate": trade_date,
        "dataType": data_type,
        "data": market_data_store.load_market_data(trade_date, data_type),
    }


@router.delete("/system/market-data/{trade_date}")
async def delete_market_data(trade_date: str, _: UserPublic = Depends(auth_store.require_admin)):
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


def _local_industry_stocks(industry_name: str) -> list[dict]:
    results = []
    for symbol in data_store.list_stock_symbols_with_data():
        profile = data_store.load_stock_data(symbol, "profile")
        if not isinstance(profile, dict):
            continue
        if str(profile.get("industry") or "").strip() != industry_name:
            continue
        results.append({"code": symbol, "name": str(profile.get("name") or "")})
    return sorted(results, key=lambda item: item["code"])


@router.get("/system/industry/{industry_name}/stocks")
async def industry_stocks(industry_name: str):
    """List stocks in a given industry, falling back to local profile data."""
    import asyncio
    import akshare as ak

    def _fetch():
        df = ak.stock_board_industry_cons_em(symbol=industry_name)
        results = []
        for _, row in df.iterrows():
            code = str(row.get("代码", ""))
            if code:
                results.append({"code": code, "name": str(row.get("名称", ""))})
        return results

    local_stocks = _local_industry_stocks(industry_name)
    try:
        stocks = await asyncio.to_thread(_fetch)
        return {"industry": industry_name, "items": stocks or local_stocks, "source": "akshare" if stocks else "local"}
    except Exception as e:
        return {"industry": industry_name, "items": local_stocks, "source": "local", "warning": str(e)}


# ── Sector Analysis (板块资金+涨停+盘口) ──────────────────────────

import asyncio as _asyncio
from adapters.akshare_adapter import (
    fetch_sector_fund_flow_rank,
    fetch_board_cons,
    fetch_bid_ask,
    fetch_limit_up_pool,
)
from adapters.pytdx_adapter import fetch_bid_ask_batch


def _load_limit_up_from_store() -> list[dict]:
    """Load limit-up pool from market data store (already downloaded)."""
    trade_date = market_data_store.get_latest_trade_date()
    if not trade_date:
        return []
    data = market_data_store.load_market_data(trade_date, "limit_up_pool")
    return data if isinstance(data, list) else []


def _load_sector_fund_from_store() -> list[dict]:
    """Load sector fund flow from market data store (already downloaded)."""
    trade_date = market_data_store.get_latest_trade_date()
    if not trade_date:
        return []
    data = market_data_store.load_market_data(trade_date, "sector_fund_flow")
    if isinstance(data, dict):
        return data.get("items", []) if data.get("available") else []
    return data if isinstance(data, list) else []


@router.get("/sector/overview")
async def sector_overview():
    """Return sector fund flow ranking merged with today's limit-up data.
    Strategy: market data store -> AKShare live -> limit-up only fallback.
    """
    source = "store"
    fund_items: list[dict] = []
    limit_rows: list[dict] = []

    # 1. Try loading from market data store
    fund_items = _load_sector_fund_from_store()
    limit_rows = _load_limit_up_from_store()

    # 2. If no fund data in store, try AKShare live
    if not fund_items:
        def _fetch_fund():
            df = fetch_sector_fund_flow_rank("今日")
            if df is not None and not df.empty:
                return df.to_dict("records")
            return []
        try:
            fund_items = await _asyncio.to_thread(_fetch_fund)
            if fund_items:
                source = "akshare"
        except Exception:
            pass

    # 3. If no limit data in store, try AKShare live
    if not limit_rows:
        today = datetime.now().strftime("%Y%m%d")
        def _fetch_limit():
            df = fetch_limit_up_pool(today)
            if df is not None and not df.empty:
                return df.to_dict("records")
            return []
        try:
            limit_rows = await _asyncio.to_thread(_fetch_limit)
            if limit_rows and source == "store":
                source = "akshare"
        except Exception:
            pass

    # Group limit-up stocks by industry
    limit_up_by_industry: dict[str, list[dict]] = {}
    for row in limit_rows:
        code = str(row.get("代码", ""))
        name = str(row.get("名称", ""))
        industry = str(row.get("所属行业", "") or "")
        if not code:
            continue
        entry = {"code": code, "name": name}
        if industry:
            limit_up_by_industry.setdefault(industry, []).append(entry)

    # Build sector list from fund flow data
    sectors = []
    if fund_items:
        for row in fund_items:
            name = str(row.get("名称", ""))
            if not name:
                continue
            limit_ups = limit_up_by_industry.get(name, [])
            sectors.append({
                "name": name,
                "changePercent": _safe_num(row.get("今日涨跌幅")),
                "mainNetInflow": _safe_num(row.get("主力净流入-净额")),
                "mainNetInflowPct": _safe_num(row.get("主力净流入-净占比")),
                "superNetInflow": _safe_num(row.get("超大单净流入-净额")),
                "bigNetInflow": _safe_num(row.get("大单净流入-净额")),
                "midNetInflow": _safe_num(row.get("中单净流入-净额")),
                "smallNetInflow": _safe_num(row.get("小单净流入-净额")),
                "limitUpCount": len(limit_ups),
                "limitUpStocks": limit_ups[:20],
            })
        sectors.sort(key=lambda s: s["mainNetInflow"], reverse=True)

    # Fallback: if no fund data at all, build from limit-up pool only
    if not sectors and limit_up_by_industry:
        source = "limit_up_only"
        for industry, stocks in limit_up_by_industry.items():
            sectors.append({
                "name": industry,
                "changePercent": 0,
                "mainNetInflow": 0,
                "mainNetInflowPct": 0,
                "superNetInflow": 0,
                "bigNetInflow": 0,
                "midNetInflow": 0,
                "smallNetInflow": 0,
                "limitUpCount": len(stocks),
                "limitUpStocks": stocks[:20],
            })
        sectors.sort(key=lambda s: s["limitUpCount"], reverse=True)

    return _json_safe({
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": source,
        "items": sectors,
    })


@router.get("/sector/{board_name}/bidask")
async def sector_bidask(board_name: str, codes: str = Query("", description="Comma-separated stock codes to look up")):
    """Fetch bid/ask order book for stocks in a sector.
    Primary: pytdx (TCP long connection, batch query).
    Fallback: AKShare -> local profile data.
    """
    stocks: list[dict] = []

    # 1. Get constituent list from AKShare
    try:
        cons_df = await _asyncio.to_thread(fetch_board_cons, board_name)
        if cons_df is not None and not cons_df.empty:
            for _, row in cons_df.iterrows():
                code = str(row.get("代码", ""))
                name = str(row.get("名称", ""))
                if code:
                    stocks.append({"code": code, "name": name})
    except Exception:
        pass

    # 2. Fallback: local profile data by industry name
    if not stocks:
        stocks = _local_industry_stocks(board_name)

    # 3. Last resort: codes from query param (limit-up stocks only)
    if not stocks and codes:
        name_map = _load_stock_name_map()
        for code in codes.split(","):
            code = code.strip()
            if code:
                stocks.append({"code": code, "name": name_map.get(code, "")})

    if not stocks:
        return _json_safe({"board": board_name, "items": [], "source": "none", "error": "无成分股数据"})

    stock_map = {s["code"]: s["name"] for s in stocks}
    all_codes = [s["code"] for s in stocks]
    items = []
    source = "profile"

    # 2. Try pytdx (batch, one call for all stocks)
    try:
        pytdx_results = await _asyncio.to_thread(fetch_bid_ask_batch, all_codes)
        if pytdx_results:
            source = "pytdx"
            for r in pytdx_results:
                code = r["code"]
                buy_total = sum(_safe_num(r.get(f"bid{i}Price", 0)) * _safe_num(r.get(f"bid{i}Volume", 0)) * 100 for i in range(1, 6))
                sell_total = sum(_safe_num(r.get(f"ask{i}Price", 0)) * _safe_num(r.get(f"ask{i}Volume", 0)) * 100 for i in range(1, 6))
                items.append({
                    "code": code,
                    "name": stock_map.get(code, "") or r.get("name", ""),
                    "price": _safe_num(r.get("price")),
                    "lastClose": _safe_num(r.get("lastClose")),
                    "changePercent": round((_safe_num(r.get("price")) / max(_safe_num(r.get("lastClose")), 0.01) - 1) * 100, 2) if r.get("lastClose") else 0,
                    "volume": _safe_num(r.get("volume")),
                    "amount": _safe_num(r.get("amount")),
                    "buy1Price": _safe_num(r.get("bid1Price")),
                    "buy1Volume": _safe_num(r.get("bid1Volume")),
                    "buy2Price": _safe_num(r.get("bid2Price")),
                    "buy2Volume": _safe_num(r.get("bid2Volume")),
                    "buy3Price": _safe_num(r.get("bid3Price")),
                    "buy3Volume": _safe_num(r.get("bid3Volume")),
                    "buy4Price": _safe_num(r.get("bid4Price")),
                    "buy4Volume": _safe_num(r.get("bid4Volume")),
                    "buy5Price": _safe_num(r.get("bid5Price")),
                    "buy5Volume": _safe_num(r.get("bid5Volume")),
                    "sell1Price": _safe_num(r.get("ask1Price")),
                    "sell1Volume": _safe_num(r.get("ask1Volume")),
                    "sell2Price": _safe_num(r.get("ask2Price")),
                    "sell2Volume": _safe_num(r.get("ask2Volume")),
                    "sell3Price": _safe_num(r.get("ask3Price")),
                    "sell3Volume": _safe_num(r.get("ask3Volume")),
                    "sell4Price": _safe_num(r.get("ask4Price")),
                    "sell4Volume": _safe_num(r.get("ask4Volume")),
                    "sell5Price": _safe_num(r.get("ask5Price")),
                    "sell5Volume": _safe_num(r.get("ask5Volume")),
                    "buyTotalAmount": buy_total,
                    "sellTotalAmount": sell_total,
                    "netAmount": buy_total - sell_total,
                })
    except Exception as e:
        logger.warning("[sector_bidask] pytdx failed: %s", e)

    # 3. Fallback: local profile data
    if not items:
        for s in stocks:
            code = s["code"]
            profile = data_store.load_stock_data(code, "profile")
            if isinstance(profile, dict):
                items.append({
                    "code": code,
                    "name": s["name"] or str(profile.get("name", "")),
                    "currentPrice": _safe_num(profile.get("currentPrice")),
                    "changePercent": _safe_num(profile.get("changePercent")),
                    "turnoverAmount": _safe_num(profile.get("turnoverAmount")),
                    "volume": _safe_num(profile.get("volume")),
                    "marketCap": _safe_num(profile.get("marketCap")),
                    "turnoverRate": _safe_num(profile.get("turnoverRate")),
                    "pe": _safe_num(profile.get("pe")),
                    "pb": _safe_num(profile.get("pb")),
                })
            else:
                items.append({"code": code, "name": s["name"]})

    # Sort
    if source == "pytdx":
        items.sort(key=lambda x: x.get("buyTotalAmount", 0), reverse=True)
    else:
        items.sort(key=lambda x: x.get("turnoverAmount", 0), reverse=True)

    return _json_safe({
        "board": board_name,
        "source": source,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total": len(items),
        "items": items,
    })


def _safe_num(value) -> float:
    try:
        v = float(value)
        return v if math.isfinite(v) else 0
    except (TypeError, ValueError):
        return 0
