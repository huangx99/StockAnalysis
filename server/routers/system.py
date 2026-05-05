import json
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
        s["name"] = name_map.get(s["symbol"], "")
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
