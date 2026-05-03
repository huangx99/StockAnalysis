import json
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Query

from models.system import SystemStatus, AIConfigRequest, AIConfigResponse
from services import ai_service
from services import data_store
from services import batch_downloader

router = APIRouter(prefix="/api", tags=["system"])


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


@router.get("/system/data-stocks")
async def data_stocks(
    page: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=200),
    q: str = Query("", description="Search by symbol or name"),
):
    all_stocks = data_store.list_stocks_with_data()

    # Load stock names
    from pathlib import Path
    import json
    stock_list_path = Path(__file__).parent.parent / "data" / "stock_list.json"
    name_map = {}
    if stock_list_path.exists():
        try:
            with open(stock_list_path, "r", encoding="utf-8") as f:
                for item in json.load(f):
                    name_map[item["code"]] = item["name"]
        except Exception:
            pass

    # Enrich with names
    for s in all_stocks:
        s["name"] = name_map.get(s["symbol"], "")

    # Filter by query
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


@router.post("/system/data-download")
async def start_download():
    return await batch_downloader.start_download()


@router.post("/system/data-stop")
async def stop_download():
    return await batch_downloader.stop_download()


@router.post("/system/data/refresh/{symbol}")
async def refresh_stock(symbol: str):
    return await batch_downloader.refresh_single(symbol)


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
        await batch_downloader._download_single(symbol, name, list(data_store.DATA_TYPES))
        return {"status": "ok", "symbol": symbol, "name": name}
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


@router.get("/system/industries")
async def list_industries():
    """List all A-share industries with stock counts."""
    import asyncio
    import akshare as ak

    def _fetch():
        df = ak.stock_board_industry_name_em()
        results = []
        for _, row in df.iterrows():
            results.append({
                "name": str(row.get("板块名称", "")),
                "code": str(row.get("板块代码", "")),
                "count": int(row.get("总家数", 0) or 0),
            })
        return results

    try:
        industries = await asyncio.to_thread(_fetch)
        return {"items": industries}
    except Exception as e:
        return {"items": [], "error": str(e)}


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
