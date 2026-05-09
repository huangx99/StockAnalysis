import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from models.auth import UserPublic
from services import auth_store, news_sentiment_service
from services.monitor_engine import evaluate_condition_tree
from services.news_sources import get_aggregator
from middleware.security import validate_search_keyword, validate_search_limit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/news", tags=["news"])


@router.get("/sentiment/overview")
async def sentiment_overview():
    latest = news_sentiment_service.load_latest()
    if latest:
        return latest.get("overview", {})
    return {
        "updatedAt": "",
        "totalCount": 0,
        "positiveCount": 0,
        "negativeCount": 0,
        "neutralCount": 0,
        "overallScore": 50,
        "marketPhase": "暂无数据",
        "trends": [],
        "hotTopics": [],
        "alerts": [],
        "topAffectedStocks": [],
    }


@router.get("/sentiment/feed")
async def sentiment_feed(
    page: int = Query(1, ge=1),
    pageSize: int = Query(30, ge=1, le=100),
    sentiment: str = Query(""),
    topic: str = Query(""),
    source: str = Query(""),
):
    return news_sentiment_service.get_feed(page, pageSize, sentiment, topic, source)


@router.get("/sentiment/trends")
async def sentiment_trends(days: int = Query(30, ge=1, le=90)):
    return news_sentiment_service.load_trend_history(days)


@router.get("/sentiment/topics")
async def sentiment_topics():
    return news_sentiment_service.get_topics()


@router.post("/sentiment/refresh")
async def refresh_sentiment():
    try:
        overview = await news_sentiment_service.refresh_news_sentiment()
        return {"ok": True, "overview": overview}
    except Exception as e:
        logger.exception("Failed to refresh news sentiment")
        return {"ok": False, "error": str(e)}


@router.get("/sentiment/stock/{symbol}")
async def stock_sentiment(symbol: str):
    return news_sentiment_service.get_stock_news(symbol)


@router.get("/sentiment/search")
async def search_news(
    keyword: str = Query(..., min_length=1),
    limit: int = Query(30, ge=1, le=50),
):
    """Real-time web search for news by keyword with sentiment analysis."""
    error = validate_search_keyword(keyword)
    if error:
        raise HTTPException(status_code=400, detail=error)
    limit = validate_search_limit(limit)
    try:
        return await news_sentiment_service.search_news_with_sentiment(keyword.strip(), limit)
    except Exception as e:
        logger.exception("Failed to search news")
        return {"items": [], "total": 0, "keyword": keyword, "error": str(e)}


@router.post("/sentiment/search")
async def search_news_filtered(
    body: dict[str, Any],
    user: UserPublic = Depends(auth_store.get_current_user),
):
    """Search news with condition tree filtering. Requires login."""
    keyword = (body.get("keyword") or "").strip()
    error = validate_search_keyword(keyword)
    if error:
        raise HTTPException(status_code=400, detail=error)
    limit = validate_search_limit(int(body.get("limit", 30)))
    condition_tree = body.get("conditionTree")

    try:
        result = await news_sentiment_service.search_news_with_sentiment(keyword, limit)
        items = result.get("items", [])

        if condition_tree and isinstance(condition_tree, dict):
            filtered = []
            for item in items:
                if evaluate_condition_tree(condition_tree, item):
                    filtered.append(item)
            items = filtered

        return {"items": items, "total": len(items), "keyword": keyword}
    except Exception as e:
        logger.exception("Failed to search news with filter")
        return {"items": [], "total": 0, "keyword": keyword, "error": str(e)}


# --- News source management ---

@router.get("/sources")
async def list_news_sources():
    """List all registered news providers and their status."""
    agg = get_aggregator()
    return [p.to_dict() for p in agg.get_providers()]


@router.post("/sources/{name}/toggle")
async def toggle_news_source(name: str):
    """Enable or disable a news provider."""
    agg = get_aggregator()
    provider = agg.get_provider(name)
    if not provider:
        return {"ok": False, "error": f"Provider '{name}' not found"}
    provider.enabled = not provider.enabled
    return {"ok": True, "name": name, "enabled": provider.enabled}
