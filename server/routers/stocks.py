from fastapi import APIRouter, Query

from models.stock import StockSearchResult, StockProfile, KLineData, FinancialStatement, DividendRecord, StockStats
from models.document import StockDocument
from services import stock_service

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
):
    return await stock_service.get_kline_data(symbol, period)


@router.get("/stock/{symbol}/financials", response_model=list[FinancialStatement])
async def financials(symbol: str):
    return await stock_service.get_financials(symbol)


@router.get("/stock/{symbol}/news", response_model=list[StockDocument])
async def news(symbol: str):
    return await stock_service.get_news(symbol)


@router.get("/stock/{symbol}/stats", response_model=StockStats)
async def stats(symbol: str):
    return await stock_service.get_stock_stats(symbol)


@router.get("/stock/{symbol}/dividends", response_model=list[DividendRecord])
async def dividends(symbol: str):
    return await stock_service.get_dividends(symbol)
