from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse, Response
import requests as http_requests
import hashlib
import logging
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

from models.stock import (
    StockSearchResult,
    StockProfile,
    KLineData,
    FinancialStatement,
    FinancialPeriodMetrics,
    FinancialSummary,
    FinancialStatementsResponse,
    DividendRecord,
    StockStats,
)
from models.document import StockDocument
from services import stock_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["stocks"])


@router.get("/search", response_model=list[StockSearchResult])
async def search(q: str = Query(..., min_length=1)):
    return await stock_service.search_stocks(q)


@router.get("/stock/{symbol}/profile", response_model=StockProfile)
async def profile(symbol: str):
    return await stock_service.get_stock_profile(symbol)


@router.get("/stock/{symbol}/kline", response_model=list[KLineData])
async def kline(
    symbol: str,
    period: str = Query("day", pattern="^(day|week|month)$"),
    limit: int = Query(0, ge=0),
):
    return await stock_service.get_kline_data(symbol, period, limit)


@router.get("/stock/{symbol}/financials", response_model=list[FinancialStatement])
async def financials(symbol: str):
    return await stock_service.get_financials(symbol)


@router.get("/stock/{symbol}/financial/periods", response_model=list[FinancialPeriodMetrics])
async def financial_periods(
    symbol: str,
    period: str = Query("quarter", pattern="^(quarter|annual)$"),
    limit: int = Query(20, ge=0),
):
    return await stock_service.get_financial_periods(symbol, period, limit)


@router.get("/stock/{symbol}/financial/summary", response_model=FinancialSummary)
async def financial_summary(symbol: str):
    return await stock_service.get_financial_summary(symbol)


@router.get("/stock/{symbol}/financial/statements", response_model=FinancialStatementsResponse)
async def financial_statements(
    symbol: str,
    type: str = Query(..., pattern="^(income|balance|cashflow)$"),
    period: str = Query("quarter", pattern="^(quarter|annual)$"),
):
    return await stock_service.get_financial_statements(symbol, type, period)


@router.get("/stock/{symbol}/financial/ratios")
async def financial_ratios(
    symbol: str,
    period: str = Query("quarter", pattern="^(quarter|annual)$"),
    limit: int = Query(20, ge=0),
):
    return await stock_service.get_financial_ratios(symbol, period, limit)


@router.get("/stock/{symbol}/financial/valuation")
async def financial_valuation(symbol: str):
    return await stock_service.get_financial_valuation(symbol)


@router.get("/stock/{symbol}/financial/alerts")
async def financial_alerts(symbol: str):
    return await stock_service.get_financial_alerts(symbol)


@router.get("/stock/{symbol}/financial/peers")
async def financial_peers(symbol: str):
    return await stock_service.get_financial_peers(symbol)


@router.get("/stock/{symbol}/news", response_model=list[StockDocument])
async def news(symbol: str):
    return await stock_service.get_news(symbol)


@router.get("/stock/{symbol}/stats", response_model=StockStats)
async def stats(symbol: str):
    return await stock_service.get_stock_stats(symbol)


@router.get("/stock/{symbol}/dividends", response_model=list[DividendRecord])
async def dividends(symbol: str):
    return await stock_service.get_dividends(symbol)


@router.post("/stock/{symbol}/news/refresh")
async def refresh_news(symbol: str):
    return await stock_service.refresh_news(symbol)


@router.get("/stock/{symbol}/notices")
async def notices(symbol: str):
    return await stock_service.get_notices(symbol)


@router.get("/stock/{symbol}/reports")
async def reports(symbol: str):
    return await stock_service.get_reports(symbol)


@router.get("/proxy/notice")
async def proxy_notice(url: str = Query(...)):
    """
    Download and serve a notice/report file, with local caching.
    Handles two URL types:
    1. cninfo disclosure detail pages — uses cninfo API to get PDF URL
    2. Direct PDF/file URLs — downloads and serves directly
    """
    fetch_headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    }

    # Cache path: hash the URL to create a unique filename
    url_hash = hashlib.md5(url.encode()).hexdigest()
    cache_dir = Path(__file__).parent.parent / "data" / "notice_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Check existing cache (any extension)
    cached_file = None
    for ext in [".pdf", ".html"]:
        candidate = cache_dir / f"{url_hash}{ext}"
        if candidate.exists():
            cached_file = candidate
            break

    if cached_file:
        logger.info("[proxy] serving cached: %s", cached_file)
        media_type = "application/pdf" if cached_file.suffix == ".pdf" else "text/html"
        return Response(
            content=cached_file.read_bytes(),
            media_type=media_type,
        )

    # ---- Handle cninfo disclosure detail URLs ----
    if "cninfo.com.cn" in url and "announcementId" in url:
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        announcement_id = (params.get("announcementId") or [None])[0]
        announcement_time = (params.get("announcementTime") or [None])[0]
        stock_code = (params.get("stockCode") or [None])[0]

        if not announcement_id:
            return HTMLResponse(content="<p>无法解析公告链接</p>", status_code=400)

        if announcement_time:
            announcement_time = unquote(announcement_time)

        try:
            is_szse = stock_code.startswith(("0", "3")) if stock_code else False
            api_resp = http_requests.post(
                "https://www.cninfo.com.cn/new/announcement/bulletin_detail",
                data={
                    "announceId": announcement_id,
                    "flag": "true" if is_szse else "false",
                    "announceTime": announcement_time or "",
                },
                headers=fetch_headers,
                timeout=15,
            )
            api_data = api_resp.json()
            file_url = api_data.get("fileUrl")
            if not file_url:
                adjunct = api_data.get("announcement", {}).get("adjunctUrl")
                if adjunct:
                    file_url = f"https://static.cninfo.com.cn/{adjunct}"
            if not file_url:
                return HTMLResponse(content="<p>无法获取公告文件链接</p>", status_code=404)

            if file_url.startswith("http://"):
                file_url = file_url.replace("http://", "https://", 1)

            pdf_resp = http_requests.get(file_url, headers=fetch_headers, timeout=30)
            if pdf_resp.status_code != 200:
                return HTMLResponse(content=f"<p>文件下载失败 (HTTP {pdf_resp.status_code})</p>", status_code=502)

            pdf_content = pdf_resp.content
            cache_path = cache_dir / f"{url_hash}.pdf"
            cache_path.write_bytes(pdf_content)
            logger.info("[proxy] cached PDF: %s (%d bytes)", cache_path, len(pdf_content))

            return Response(content=pdf_content, media_type="application/pdf")

        except Exception as e:
            logger.error("[proxy] cninfo fetch failed: %s", e)
            return HTMLResponse(content=f"<p>获取公告失败: {e}</p>", status_code=502)

    # ---- Handle direct file URLs (PDF reports etc.) ----
    try:
        file_resp = http_requests.get(url, headers=fetch_headers, timeout=30)
        if file_resp.status_code != 200:
            return HTMLResponse(content=f"<p>文件下载失败 (HTTP {file_resp.status_code})</p>", status_code=502)

        content = file_resp.content
        content_type = file_resp.headers.get("Content-Type", "application/octet-stream")

        # Determine extension
        if "pdf" in content_type or url.endswith(".pdf"):
            ext = ".pdf"
            media_type = "application/pdf"
        elif "html" in content_type:
            ext = ".html"
            media_type = "text/html"
        else:
            ext = ".pdf"
            media_type = "application/pdf"

        cache_path = cache_dir / f"{url_hash}{ext}"
        cache_path.write_bytes(content)
        logger.info("[proxy] cached file: %s (%d bytes)", cache_path, len(content))

        return Response(content=content, media_type=media_type)

    except Exception as e:
        logger.error("[proxy] file fetch failed: %s", e)
        return HTMLResponse(content=f"<p>获取文件失败: {e}</p>", status_code=502)
