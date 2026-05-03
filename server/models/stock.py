from pydantic import BaseModel
from typing import Literal


class StockSearchResult(BaseModel):
    symbol: str
    name: str
    market: Literal["SH", "SZ", "BJ"]
    pinyin: str


class StockProfile(BaseModel):
    symbol: str
    name: str
    market: str
    industry: str
    currentPrice: float
    change: float
    changePercent: float
    marketCap: float
    pe: float
    pb: float
    dividendYield: float
    turnoverRate: float
    volume: float
    updateTime: str
    # New fields from spot data
    open: float = 0.0
    high: float = 0.0
    low: float = 0.0
    previousClose: float = 0.0
    amplitude: float = 0.0
    turnoverAmount: float = 0.0
    freeFloatMarketCap: float = 0.0
    change60d: float = 0.0
    changeYtd: float = 0.0
    volumeRatio: float = 0.0


class KLineData(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    ma5: float | None = None
    ma10: float | None = None
    ma20: float | None = None
    ma60: float | None = None


class FinancialStatement(BaseModel):
    year: int
    revenue: float = 0.0
    netProfit: float = 0.0
    grossMargin: float = 0.0
    roe: float = 0.0
    operatingCashFlow: float = 0.0
    totalAssets: float = 0.0
    totalLiabilities: float = 0.0
    equity: float = 0.0
    # Profit statement — new fields
    eps: float = 0.0
    operatingProfit: float = 0.0
    totalProfitBeforeTax: float = 0.0
    totalOperatingCost: float = 0.0
    rdExpense: float = 0.0
    financeExpense: float = 0.0
    # Cashflow statement — previously fetched but discarded
    investingCashFlow: float = 0.0
    financingCashFlow: float = 0.0


class DividendRecord(BaseModel):
    year: int
    dividendPerShare: float = 0.0
    bonusShares: float = 0.0
    reservePerShare: float = 0.0
    exDate: str = ""
    recordDate: str = ""


class MarketStats(BaseModel):
    change5d: float
    change20d: float
    change60d: float
    changeYtd: float
    volatility: float
    maxDrawdown: float


class TechnicalIndicators(BaseModel):
    ma5: float | None = None
    ma10: float | None = None
    ma20: float | None = None
    ma60: float | None = None
    maSignal: str
    maDesc: str
    macdDif: float = 0.0
    macdDea: float = 0.0
    macdValue: float = 0.0
    macdSignal: str
    macdDesc: str
    rsiValue: float = 50.0
    rsiSignal: str
    rsiDesc: str
    bollingerUpper: float = 0.0
    bollingerMiddle: float = 0.0
    bollingerLower: float = 0.0
    bollingerPosition: str
    bollingerSignal: str
    bollingerDesc: str


class StockStats(BaseModel):
    marketStats: MarketStats
    technicalIndicators: TechnicalIndicators
