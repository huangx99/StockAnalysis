import asyncio
import logging
import time
from pathlib import Path

import akshare as ak
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from routers import stocks, system, ai, screener, backtest, auth, news
from utils.logging_config import setup_logging
from services.stock_service import prewarm_spot_cache
from services.auth_store import ensure_seed_admin
from services.data_sources import init_data_sources
from services.news_sources import init_news_sources

# 前端构建产物目录
DIST_DIR = Path(__file__).parent.parent / "app" / "dist"

setup_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="A-Stock AI Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    path = request.url.path
    # Only log API requests, skip static files
    if path.startswith("/api"):
        logger.info(">>> %s %s", request.method, path)
        t0 = time.time()
        response = await call_next(request)
        elapsed = time.time() - t0
        logger.info("<<< %s %s → %d (%.2fs)", request.method, path, response.status_code, elapsed)
        return response
    return await call_next(request)

app.include_router(stocks.router)
app.include_router(ai.router)
app.include_router(system.router)
app.include_router(screener.router)
app.include_router(backtest.router)
app.include_router(auth.router)
app.include_router(news.router)

from routers import monitor
app.include_router(monitor.router)


@app.on_event("startup")
async def startup():
    ensure_seed_admin()

    # Initialize data source abstraction layer
    await init_data_sources(
        akshare_threads=settings.ds_akshare_threads,
        yahoo_threads=settings.ds_yahoo_threads,
        pytdx_threads=settings.ds_pytdx_threads,
        recovery_interval=settings.ds_circuit_breaker_recovery,
    )

    # Initialize pluggable news sources
    init_news_sources()

    # Background auto-refresh for news sentiment (every 30 min)
    asyncio.create_task(_auto_refresh_news())

    # Background monitor engine
    from services.monitor_engine import monitor_loop
    asyncio.create_task(monitor_loop())

    actual = getattr(ak, "__version__", "unknown")
    if actual != settings.akshare_version:
        logger.warning(
            "AKShare version mismatch: expected %s, got %s",
            settings.akshare_version,
            actual,
        )
    else:
        logger.info("AKShare version %s OK", actual)

    # Light connectivity check - just verify functions exist
    funcs = ["stock_zh_a_spot_em", "stock_zh_a_hist", "stock_news_em"]
    for fn in funcs:
        if hasattr(ak, fn):
            logger.info("AKShare function %s: available", fn)
        else:
            logger.warning("AKShare function %s: NOT FOUND", fn)

    # Avoid expensive full-market AKShare fetch on every startup when local stock list exists.
    stock_list_path = Path(__file__).parent / "data" / "stock_list.json"
    if not stock_list_path.exists():
        asyncio.create_task(_prewarm())
    else:
        logger.info("Stock list exists, skip startup spot prewarm")


async def _prewarm():
    try:
        await prewarm_spot_cache()
    except Exception as e:
        logger.warning("Spot cache prewarm failed: %s", e)


_shutdown = False


async def _auto_refresh_news():
    """Background task: refresh news sentiment every 30 minutes."""
    global _shutdown
    from services.news_sentiment_service import refresh_news_sentiment

    # Wait 60s before first refresh to let providers initialize
    await asyncio.sleep(60)

    while not _shutdown:
        try:
            overview = await refresh_news_sentiment()
            total = overview.get("totalCount", 0)
            alerts = len(overview.get("alerts", []))
            logger.info("Auto-refresh completed: %d items, %d alerts", total, alerts)
        except Exception as e:
            logger.warning("Auto-refresh failed: %s", e)

        # Sleep 30 minutes
        for _ in range(180):
            if _shutdown:
                break
            await asyncio.sleep(10)


@app.on_event("shutdown")
async def shutdown():
    global _shutdown
    _shutdown = True
    from services.monitor_engine import stop_monitor
    stop_monitor()


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled error on %s: %s", request.url, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "code": "INTERNAL_ERROR"},
    )


# 挂载前端静态文件
if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """所有非 /api 路由返回前端 index.html（SPA 路由）"""
        if full_path.startswith("api/"):
            return JSONResponse(
                status_code=404,
                content={"detail": "API endpoint not found", "code": "API_NOT_FOUND"},
            )
        file_path = DIST_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(DIST_DIR / "index.html")
else:
    @app.get("/")
    async def root():
        return {"status": "ok", "version": "1.0.0", "note": "前端未构建，请先运行 npm run build"}
