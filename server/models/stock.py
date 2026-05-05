from pydantic import BaseModel, Field
from typing import Any, Literal


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


class FinancialPeriodMetrics(BaseModel):
    symbol: str
    reportDate: str
    reportYear: int
    reportQuarter: Literal["Q1", "H1", "Q3", "FY"]
    reportType: str = ""
    noticeDate: str = ""
    currency: str = "CNY"
    source: str = ""
    revenue: float = 0.0
    revenueYoY: float = 0.0
    operatingCost: float = 0.0
    grossProfit: float = 0.0
    grossMargin: float = 0.0
    salesExpense: float = 0.0
    manageExpense: float = 0.0
    rdExpense: float = 0.0
    financeExpense: float = 0.0
    operatingProfit: float = 0.0
    totalProfit: float = 0.0
    netProfit: float = 0.0
    netProfitYoY: float = 0.0
    deductedNetProfit: float = 0.0
    eps: float = 0.0
    netMargin: float = 0.0
    roe: float = 0.0
    roa: float = 0.0
    totalAssets: float = 0.0
    totalLiabilities: float = 0.0
    equity: float = 0.0
    cash: float = 0.0
    accountsReceivable: float = 0.0
    inventory: float = 0.0
    contractLiability: float = 0.0
    goodwill: float = 0.0
    debtAssetRatio: float = 0.0
    currentRatio: float = 0.0
    quickRatio: float = 0.0
    assetTurnover: float = 0.0
    receivableTurnover: float = 0.0
    inventoryTurnover: float = 0.0
    operatingCashFlow: float = 0.0
    operatingCashFlowYoY: float = 0.0
    investingCashFlow: float = 0.0
    financingCashFlow: float = 0.0
    capex: float = 0.0
    freeCashFlow: float = 0.0
    cfoToNetProfit: float = 0.0


class FinancialScores(BaseModel):
    total: int = 0
    growth: int = 0
    profitability: int = 0
    cashflow: int = 0
    solvency: int = 0
    efficiency: int = 0
    shareholderReturn: int = 0


class FinancialAlert(BaseModel):
    level: Literal["info", "warning", "danger"]
    title: str
    message: str
    metric: str = ""
    period: str = ""


class FinancialSummary(BaseModel):
    symbol: str
    latestPeriod: FinancialPeriodMetrics | None = None
    annual: list[FinancialPeriodMetrics] = Field(default_factory=list)
    quarterly: list[FinancialPeriodMetrics] = Field(default_factory=list)
    scores: FinancialScores = FinancialScores()
    alerts: list[FinancialAlert] = Field(default_factory=list)
    dataSource: str = ""
    updatedAt: str = ""


class FinancialStatementsResponse(BaseModel):
    symbol: str
    statementType: Literal["income", "balance", "cashflow"]
    rows: list[dict[str, Any]] = Field(default_factory=list)


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


class ScreenerRequest(BaseModel):
    preset: Literal["consecutive_growth", "recent_strength", "profit_growth_rank", "custom"] = "custom"
    formula: str | None = None
    sortFormula: str | None = None
    minRoe: float | None = None
    maxDebtRatio: float | None = None
    minRevenueYoY: float | None = None
    minNetProfitYoY: float | None = None
    maxPe: float | None = None
    maxPb: float | None = None
    minMarketCap: float | None = None
    maxMarketCap: float | None = None
    industry: str | None = None
    q: str | None = None
    sortBy: str = "netProfitYoY"
    sortDir: Literal["asc", "desc"] = "desc"
    page: int = 1
    pageSize: int = 50


class ScreenedStock(BaseModel):
    symbol: str
    name: str = ""
    industry: str = ""
    currentPrice: float = 0.0
    changePercent: float = 0.0
    pe: float = 0.0
    pb: float = 0.0
    marketCap: float = 0.0
    roe: float = 0.0
    netProfitYoY: float = 0.0
    revenueYoY: float = 0.0
    grossMargin: float = 0.0
    netMargin: float = 0.0
    debtAssetRatio: float = 0.0
    consecutiveGrowthYears: int = 0
    recentStrength: float = 0.0
    hasProfileData: bool = True
    hasFinancialData: bool = True
    hasKlineData: bool = True
    formulaValues: dict[str, Any] = Field(default_factory=dict)
    formulaReason: str = ""
    formulaSortValue: float | None = None


class ScreenerDiagnosis(BaseModel):
    stock: ScreenedStock
    reasons: list[str] = Field(default_factory=list)


class FormulaGenerateRequest(BaseModel):
    description: str


class FormulaGenerateResponse(BaseModel):
    ok: bool = False
    formula: str = ""
    filterFormula: str = ""
    sortFormula: str = ""
    sortDir: Literal["asc", "desc"] = "desc"
    title: str = ""
    summary: str = ""
    explanation: str = ""
    investmentLogic: list[str] = Field(default_factory=list)
    useCases: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)
    usedFields: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    validationPlan: list[str] = Field(default_factory=list)
    reason: str = ""


class ScreenerInsight(BaseModel):
    title: str = ""
    summary: str = ""
    generationMethod: str = "规则生成"
    generatedAt: str = ""
    timeRange: str = ""
    rankingReasons: list[str] = Field(default_factory=list)
    structureInsights: list[str] = Field(default_factory=list)
    newsInsights: list[str] = Field(default_factory=list)
    reportInsights: list[str] = Field(default_factory=list)
    conclusion: str = ""
    nextSteps: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class ScreenerResponse(BaseModel):
    items: list[ScreenedStock] = Field(default_factory=list)
    total: int = 0
    matchedCount: int = 0
    page: int = 1
    pageSize: int = 50
    scannedCount: int = 0
    dataDate: str = ""
    diagnosis: ScreenerDiagnosis | None = None
    insight: ScreenerInsight | None = None
