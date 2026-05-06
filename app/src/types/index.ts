export interface StockSearchResult {
  symbol: string;
  name: string;
  market: 'SH' | 'SZ' | 'BJ';
  pinyin: string;
}

export interface StockProfile {
  symbol: string;
  name: string;
  market: string;
  industry: string;
  currentPrice: number;
  change: number;
  changePercent: number;
  marketCap: number;
  pe: number;
  pb: number;
  dividendYield: number;
  turnoverRate: number;
  volume: number;
  updateTime: string;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  amplitude: number;
  turnoverAmount: number;
  freeFloatMarketCap: number;
  change60d: number;
  changeYtd: number;
  volumeRatio: number;
}

export interface MarketStats {
  change5d: number;
  change20d: number;
  change60d: number;
  changeYtd: number;
  volatility: number;
  maxDrawdown: number;
}

export interface TechnicalIndicators {
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  maSignal: string;
  maDesc: string;
  macdDif: number;
  macdDea: number;
  macdValue: number;
  macdSignal: string;
  macdDesc: string;
  rsiValue: number;
  rsiSignal: string;
  rsiDesc: string;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  bollingerPosition: string;
  bollingerSignal: string;
  bollingerDesc: string;
}

export interface StockStats {
  marketStats: MarketStats;
  technicalIndicators: TechnicalIndicators;
}

export interface KLineData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma5?: number;
  ma10?: number;
  ma20?: number;
  ma60?: number;
}

export interface FinancialStatement {
  year: number;
  revenue: number;
  netProfit: number;
  grossMargin: number;
  roe: number;
  operatingCashFlow: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  eps: number;
  operatingProfit: number;
  totalProfitBeforeTax: number;
  totalOperatingCost: number;
  rdExpense: number;
  financeExpense: number;
  investingCashFlow: number;
  financingCashFlow: number;
}

export interface FinancialPeriodMetrics {
  symbol: string;
  reportDate: string;
  reportYear: number;
  reportQuarter: 'Q1' | 'H1' | 'Q3' | 'FY';
  reportType: string;
  noticeDate: string;
  currency: string;
  source: string;
  revenue: number;
  revenueYoY: number;
  operatingCost: number;
  grossProfit: number;
  grossMargin: number;
  salesExpense: number;
  manageExpense: number;
  rdExpense: number;
  financeExpense: number;
  operatingProfit: number;
  totalProfit: number;
  netProfit: number;
  netProfitYoY: number;
  deductedNetProfit: number;
  eps: number;
  netMargin: number;
  roe: number;
  roa: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  cash: number;
  accountsReceivable: number;
  inventory: number;
  contractLiability: number;
  goodwill: number;
  debtAssetRatio: number;
  currentRatio: number;
  quickRatio: number;
  assetTurnover: number;
  receivableTurnover: number;
  inventoryTurnover: number;
  operatingCashFlow: number;
  operatingCashFlowYoY: number;
  investingCashFlow: number;
  financingCashFlow: number;
  capex: number;
  freeCashFlow: number;
  cfoToNetProfit: number;
}

export interface FinancialScores {
  total: number;
  growth: number;
  profitability: number;
  cashflow: number;
  solvency: number;
  efficiency: number;
  shareholderReturn: number;
}

export interface FinancialAlert {
  level: 'info' | 'warning' | 'danger';
  title: string;
  message: string;
  metric: string;
  period: string;
}

export interface FinancialSummary {
  symbol: string;
  latestPeriod: FinancialPeriodMetrics | null;
  annual: FinancialPeriodMetrics[];
  quarterly: FinancialPeriodMetrics[];
  scores: FinancialScores;
  alerts: FinancialAlert[];
  dataSource: string;
  updatedAt: string;
}

export interface FinancialStatementsResponse {
  symbol: string;
  statementType: 'income' | 'balance' | 'cashflow';
  rows: Record<string, unknown>[];
}

export interface DividendRecord {
  year: number;
  dividendPerShare: number;
  bonusShares: number;
  reservePerShare: number;
  exDate: string;
  recordDate: string;
}

export interface AIAnalysis {
  summary: string;
  score: number;
  style: string;
  companyOverview: string;
  marketPerformance: string;
  financialPerformance: string;
  valuationAnalysis: string;
  newsDigest: string;
  highlights: string[];
  risks: string[];
  conclusion: string;
}

export interface StockDocument {
  id: string;
  title: string;
  type: 'news' | 'announcement' | 'report';
  publishTime: string;
  source: string;
  summary: string;
  content: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  risks: string[];
  url?: string;
}

export interface NewsAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative';
  summary: string;
  key_points: string[];
  risk_factors: string[];
}

export interface AIReport {
  sections: {
    title: string;
    content: string;
  }[];
  generatedAt: string;
}

export interface SystemStatus {
  akshare: 'online' | 'offline';
  aiService: 'online' | 'offline';
  dataSource: string;
  lastUpdate: string;
}

export interface DownloadStatus {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  total: number;
  completed: number;
  failed: string[];
  lastSymbol: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  dataTypes: string[];
  logs: string[];
}

export interface SingleDownloadProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  symbol?: string;
  name?: string;
  dataTypes?: string[];
  completedTypes?: { type: string; count: number }[];
  currentIndex?: number;
  logs?: string[];
  startedAt?: string;
  updatedAt?: string;
}

export interface StockDataSummary {
  symbol: string;
  name?: string;
  industry?: string;
  exists: boolean;
  dataTypes: Record<string, { exists: boolean; size: number; updatedAt: string | null }>;
  totalSize: number;
  missingDataTypes?: string[];
  missingCount?: number;
}

export interface DataStocksResponse {
  total: number;
  page: number;
  pageSize: number;
  items: StockDataSummary[];
}

export interface IndustrySummaryItem {
  industry: string;
  count: number;
  scorableCount: number;
}

export interface IndustryListResponse {
  updatedAt?: string;
  items: IndustrySummaryItem[];
}

export interface IndustryPeerProfile {
  symbol: string;
  name: string;
  industry: string;
  currentPrice: number;
  changePercent: number;
  marketCap: number;
  pe: number;
  pb: number;
}

export interface IndustryPeerData {
  symbol: string;
  name: string;
  industry: string;
  profile: IndustryPeerProfile;
  periods: FinancialPeriodMetrics[];
  hasFinancialData: boolean;
}

export interface IndustryCompareResponse {
  industry: string;
  period: 'annual' | 'quarter';
  updatedAt?: string;
  total: number;
  items: IndustryPeerData[];
}

export interface MarketDownloadStatus {
  status: 'idle' | 'running' | 'pausing' | 'paused' | 'cancelling' | 'cancelled' | 'completed' | 'error';
  jobId?: string | null;
  tradeDate: string | null;
  tradeDates?: string[];
  total: number;
  completed: number;
  failed: string[];
  currentType: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  dataTypes: string[];
  logs: string[];
}

export interface ScreenerRequest {
  preset: 'consecutive_growth' | 'recent_strength' | 'profit_growth_rank' | 'custom';
  formula?: string | null;
  sortFormula?: string | null;
  minRoe?: number | null;
  maxDebtRatio?: number | null;
  minRevenueYoY?: number | null;
  minNetProfitYoY?: number | null;
  maxPe?: number | null;
  maxPb?: number | null;
  minMarketCap?: number | null;
  maxMarketCap?: number | null;
  industry?: string | null;
  q?: string | null;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ScreenedStock {
  symbol: string;
  name: string;
  industry: string;
  currentPrice: number;
  changePercent: number;
  pe: number;
  pb: number;
  marketCap: number;
  roe: number;
  netProfitYoY: number;
  revenueYoY: number;
  grossMargin: number;
  netMargin: number;
  debtAssetRatio: number;
  consecutiveGrowthYears: number;
  recentStrength: number;
  hasProfileData?: boolean;
  hasFinancialData?: boolean;
  hasKlineData?: boolean;
  formulaValues?: Record<string, unknown>;
  formulaReason?: string;
  formulaSortValue?: number | null;
}


export interface FormulaFieldMeta {
  key: string;
  label: string;
  category: string;
  description: string;
  aliases: string[];
  unit?: string;
}

export interface FormulaGenerateResponse {
  ok: boolean;
  formula?: string;
  filterFormula?: string;
  sortFormula?: string;
  sortDir?: 'asc' | 'desc';
  title?: string;
  summary?: string;
  explanation?: string;
  investmentLogic?: string[];
  useCases?: string[];
  steps?: string[];
  usedFields?: { name: string; meaning?: string; unit?: string }[];
  warnings?: string[];
  validationPlan?: string[];
  reason?: string;
}


export interface ScreenerInsight {
  title: string;
  summary: string;
  generationMethod?: string;
  generatedAt?: string;
  timeRange?: string;
  rankingReasons: string[];
  structureInsights: string[];
  newsInsights: string[];
  reportInsights: string[];
  conclusion: string;
  nextSteps: string[];
  warnings: string[];
  limitations?: string[];
  evidence: {
    symbol?: string;
    name?: string;
    type?: string;
    title?: string;
    date?: string;
    source?: string;
    rating?: string;
  }[];
}

export interface ScreenerDiagnosis {
  stock: ScreenedStock;
  reasons: string[];
}

export interface ScreenerResponse {
  items: ScreenedStock[];
  total: number;
  matchedCount: number;
  page: number;
  pageSize: number;
  scannedCount: number;
  dataDate?: string;
  diagnosis?: ScreenerDiagnosis | null;
  insight?: ScreenerInsight | null;
}

export interface MarketDataSummary {
  tradeDate: string;
  exists: boolean;
  dataTypes: Record<string, { exists: boolean; size: number; updatedAt: string | null }>;
  totalSize: number;
  overview?: {
    tradeDate: string;
    updatedAt: string;
    totalTurnover: number;
    upCount: number;
    downCount: number;
    flatCount: number;
    avgChangePercent: number;
    medianChangePercent: number;
    northNetBuy: number | null;
    northNetInflow: number | null;
    northDataDate?: string;
    northDataStatus?: string;
    limitUpCount: number;
    limitDownCount: number;
    limitUpAvailable?: boolean;
    limitDownAvailable?: boolean;
    sourceErrors?: Record<string, string>;
    source: string;
  } | null;
  sentiment?: {
    tradeDate: string;
    updatedAt: string;
    limitUpCount: number;
    limitDownCount: number;
    limitUpAvailable?: boolean;
    limitDownAvailable?: boolean;
    dataQuality?: 'complete' | 'partial';
    sourceErrors?: Record<string, string>;
    highestBoard: number;
    breakCount: number;
    breakRate: number;
    marketPhase: string;
    hotIndustries: { industry: string; limitUpCount: number }[];
    leaders: Record<string, unknown>[];
  } | null;
  marketIndices?: {
    items: Record<string, unknown>[];
    leader?: Record<string, unknown> | null;
    laggard?: Record<string, unknown> | null;
    coverage?: { matched: number; total: number };
  } | null;
  breadth?: {
    distribution?: { range: string; count: number }[];
    newHighLow?: Record<string, unknown> | null;
    activity?: Record<string, unknown>[];
    turnoverStats?: Record<string, unknown>;
  } | null;
  styleRotation?: {
    styles?: Record<string, unknown>[];
    leader?: Record<string, unknown> | null;
    laggard?: Record<string, unknown> | null;
  } | null;
  qualityReport?: {
    level: 'complete' | 'warning' | 'error';
    score: number;
    summary: string;
    checks: Record<string, unknown>[];
  } | null;
}

export interface BacktestRequest {
  industry?: string | null;
  asOfDate: string;
  endDate: string;
  topN: number;
  scoreMode: 'composite' | 'opportunity' | 'quality' | 'growth' | 'profitability' | 'cashflow' | 'safety' | 'efficiency' | 'valuation';
  formula?: string | null;
  sortFormula?: string | null;
  sortDir?: 'asc' | 'desc';
  rebalanceFrequency?: 'none' | 'quarter';
  benchmark?: 'industry_equal' | 'all_a_equal';
  minPeriods?: number;
  maxSymbols?: number;
}

export interface BacktestStockRow {
  symbol: string;
  name: string;
  industry: string;
  score: number;
  scoreBreakdown: Record<string, number>;
  latestPeriod: string;
  formulaSortValue?: number | null;
  formulaValues?: Record<string, unknown>;
  startDate: string;
  endDate: string;
  startPrice: number;
  endPrice: number;
  returnPct: number;
  maxDrawdown: number;
  excessReturn: number;
  horizons: Record<string, number | null>;
  reasons: string[];
}

export interface BacktestPortfolioMetrics {
  avgReturn: number;
  medianReturn: number;
  winRate: number;
  avgExcess: number;
  maxDrawdown: number;
  count: number;
  benchmarkReturn?: number;
}

export interface BacktestGroupSummary extends BacktestPortfolioMetrics {
  group: string;
}

export interface BacktestFactorValidation {
  factor: string;
  rankIc: number;
  topAvgReturn: number;
  topWinRate: number;
}

export interface BacktestRollingPoint {
  asOfDate: string;
  endDate: string;
  avgReturn: number;
  benchmarkReturn: number;
  avgExcess: number;
  rankIc: number;
  count: number;
}

export interface BacktestResponse {
  params: BacktestRequest;
  asOfDate: string;
  endDate: string;
  universeCount: number;
  benchmarkReturn: number;
  topPortfolio: BacktestPortfolioMetrics;
  allPortfolio: BacktestPortfolioMetrics;
  rankIc: number;
  topRows: BacktestStockRow[];
  allRows: BacktestStockRow[];
  groups: {
    top: BacktestStockRow[];
    middle: BacktestStockRow[];
    bottom: BacktestStockRow[];
    summary: BacktestGroupSummary[];
  };
  factorValidation: BacktestFactorValidation[];
  mistakes: BacktestStockRow[];
  insights: string[];
  rolling: BacktestRollingPoint[];
  generatedAt: string;
}
