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
  sentiment: 'positive' | 'neutral' | 'negative';
  risks: string[];
  url?: string;
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
  status: 'idle' | 'running' | 'paused' | 'completed';
  total: number;
  completed: number;
  failed: string[];
  lastSymbol: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  dataTypes: string[];
  logs: string[];
}

export interface StockDataSummary {
  symbol: string;
  name?: string;
  exists: boolean;
  dataTypes: Record<string, { exists: boolean; size: number; updatedAt: string | null }>;
  totalSize: number;
}

export interface DataStocksResponse {
  total: number;
  page: number;
  pageSize: number;
  items: StockDataSummary[];
}
