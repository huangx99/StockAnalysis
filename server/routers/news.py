import logging
from fastapi import APIRouter, Query
from services import news_sentiment_service
from services.news_sources import get_aggregator

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
    try:
        return await news_sentiment_service.search_news_with_sentiment(keyword, limit)
    except Exception as e:
        logger.exception("Failed to search news")
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
