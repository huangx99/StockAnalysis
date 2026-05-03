import type {
  StockSearchResult,
  StockProfile,
  KLineData,
  FinancialStatement,
  DividendRecord,
  AIAnalysis,
  StockDocument,
  AIReport,
  SystemStatus,
} from '../../types';

/* ── helper ─────────────────────────────────────────────── */
const delay = (min = 300, max = 800) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, Math.random() * (max - min) + min)
  );

/* ── seed data ──────────────────────────────────────────── */
const MOCK_STOCKS: StockSearchResult[] = [
  { symbol: '600519', name: '贵州茅台', market: 'SH', pinyin: 'MT' },
  { symbol: '000001', name: '平安银行', market: 'SZ', pinyin: 'PA' },
  { symbol: '000858', name: '五粮液', market: 'SZ', pinyin: 'WLY' },
  { symbol: '300750', name: '宁德时代', market: 'SZ', pinyin: 'ND' },
  { symbol: '002594', name: '比亚迪', market: 'SZ', pinyin: 'BYD' },
  { symbol: '601318', name: '中国平安', market: 'SH', pinyin: 'PA' },
  { symbol: '600036', name: '招商银行', market: 'SH', pinyin: 'ZS' },
];

const PROFILES: Record<string, StockProfile> = {
  '600519': {
    symbol: '600519',
    name: '贵州茅台',
    market: 'SH',
    industry: '白酒',
    currentPrice: 1688.88,
    change: 12.34,
    changePercent: 0.74,
    marketCap: 2123456000000,
    pe: 28.5,
    pb: 9.2,
    dividendYield: 1.45,
    turnoverRate: 0.18,
    volume: 1234567,
    updateTime: '2026-05-03 15:00:00',
    open: 1680.00, high: 1695.00, low: 1675.00, previousClose: 1676.54,
    amplitude: 1.20, turnoverAmount: 2080000000, freeFloatMarketCap: 2123456000000,
    change60d: 5.23, changeYtd: 12.45,
    volumeRatio: 1.35,
  },
  '000001': {
    symbol: '000001',
    name: '平安银行',
    market: 'SZ',
    industry: '银行',
    currentPrice: 12.56,
    change: -0.23,
    changePercent: -1.8,
    marketCap: 243000000000,
    pe: 5.6,
    pb: 0.58,
    dividendYield: 4.2,
    turnoverRate: 0.85,
    volume: 45678901,
    updateTime: '2026-05-03 15:00:00',
    open: 12.80, high: 12.90, low: 12.50, previousClose: 12.79,
    amplitude: 3.13, turnoverAmount: 573000000, freeFloatMarketCap: 243000000000,
    change60d: -3.45, changeYtd: 5.67,
    volumeRatio: 0.82,
  },
  '000858': {
    symbol: '000858',
    name: '五粮液',
    market: 'SZ',
    industry: '白酒',
    currentPrice: 145.32,
    change: 2.18,
    changePercent: 1.52,
    marketCap: 564200000000,
    pe: 22.1,
    pb: 5.8,
    dividendYield: 2.1,
    turnoverRate: 0.42,
    volume: 8765432,
    updateTime: '2026-05-03 15:00:00',
    open: 143.00, high: 146.50, low: 142.80, previousClose: 143.14,
    amplitude: 2.58, turnoverAmount: 1270000000, freeFloatMarketCap: 564200000000,
    change60d: 8.12, changeYtd: 15.34,
    volumeRatio: 1.08,
  },
  '300750': {
    symbol: '300750',
    name: '宁德时代',
    market: 'SZ',
    industry: '电池',
    currentPrice: 198.5,
    change: 5.2,
    changePercent: 2.69,
    marketCap: 872100000000,
    pe: 35.2,
    pb: 6.5,
    dividendYield: 0.8,
    turnoverRate: 1.25,
    volume: 23456789,
    updateTime: '2026-05-03 15:00:00',
    open: 193.50, high: 200.00, low: 192.00, previousClose: 193.30,
    amplitude: 4.14, turnoverAmount: 4620000000, freeFloatMarketCap: 872100000000,
    change60d: 12.56, changeYtd: 28.90,
    volumeRatio: 1.65,
  },
};

/* ── API functions ─────────────────────────────────────── */

/**
 * GET /api/search?q={query}
 * Fuzzy search stocks by code / name / pinyin
 */
export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  await delay();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return MOCK_STOCKS.filter(
    (s) =>
      s.symbol.includes(q) ||
      s.name.includes(q) ||
      s.pinyin.toLowerCase().includes(q)
  );
}

/**
 * GET /api/stock/{symbol}/profile
 * Basic stock info, current price, metrics
 */
export async function getStockProfile(symbol: string): Promise<StockProfile> {
  await delay();
  const p = PROFILES[symbol];
  if (!p) throw new Error(`Stock ${symbol} not found`);
  return p;
}

/**
 * GET /api/stock/{symbol}/kline?period=day&ma=5,10,20,60
 * OHLCV + moving averages
 */
export async function getKLineData(
  symbol: string,
  period: 'day' | 'week' | 'month' = 'day'
): Promise<KLineData[]> {
  await delay(400, 900);
  const basePrice = PROFILES[symbol]?.currentPrice ?? 100;
  const days = period === 'day' ? 60 : period === 'week' ? 52 : 24;
  const data: KLineData[] = [];
  let price = basePrice * 0.92;
  for (let i = 0; i < days; i++) {
    const change = (Math.random() - 0.48) * basePrice * 0.03;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * basePrice * 0.015;
    const low = Math.min(open, close) - Math.random() * basePrice * 0.015;
    const volume = Math.floor(1000000 + Math.random() * 5000000);
    data.push({
      date: `2026-0${Math.floor(i / 30) + 3}-${String((i % 30) + 1).padStart(2, '0')}`,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume,
    });
    price = close;
  }
  // Simple MA
  const ma = (n: number, idx: number) => {
    if (idx < n - 1) return undefined;
    const sum = data.slice(idx - n + 1, idx + 1).reduce((s, d) => s + d.close, 0);
    return Number((sum / n).toFixed(2));
  };
  return data.map((d, i) => ({
    ...d,
    ma5: ma(5, i),
    ma10: ma(10, i),
    ma20: ma(20, i),
    ma60: ma(60, i),
  }));
}

/**
 * GET /api/stock/{symbol}/financials?type=income
 * Income / balance / cash flow statements
 */
export async function getFinancials(symbol: string): Promise<FinancialStatement[]> {
  await delay();
  const baseRevenue = symbol === '600519' ? 15000000000 : symbol === '000001' ? 180000000000 : 50000000000;
  return [2022, 2023, 2024, 2025].map((year) => ({
    year,
    revenue: Math.floor(baseRevenue * (1 + (year - 2022) * 0.08 + Math.random() * 0.05)),
    netProfit: Math.floor(baseRevenue * 0.25 * (1 + (year - 2022) * 0.03)),
    grossMargin: Number((45 + Math.random() * 10).toFixed(1)),
    roe: Number((15 + Math.random() * 10).toFixed(1)),
    operatingCashFlow: Math.floor(baseRevenue * 0.3 * (1 + (year - 2022) * 0.05)),
    totalAssets: Math.floor(baseRevenue * 3 * (1 + (year - 2022) * 0.1)),
    totalLiabilities: Math.floor(baseRevenue * 1.5 * (1 + (year - 2022) * 0.08)),
    equity: Math.floor(baseRevenue * 1.5 * (1 + (year - 2022) * 0.12)),
    eps: Number((3 + (year - 2022) * 0.5 + Math.random() * 0.5).toFixed(2)),
    operatingProfit: Math.floor(baseRevenue * 0.3 * (1 + (year - 2022) * 0.04)),
    totalProfitBeforeTax: Math.floor(baseRevenue * 0.32 * (1 + (year - 2022) * 0.04)),
    totalOperatingCost: Math.floor(baseRevenue * 0.7 * (1 + (year - 2022) * 0.06)),
    rdExpense: Math.floor(baseRevenue * 0.03 * (1 + (year - 2022) * 0.1)),
    financeExpense: Math.floor(baseRevenue * 0.01 * (1 - (year - 2022) * 0.05)),
    investingCashFlow: -Math.floor(baseRevenue * 0.15 * (1 + (year - 2022) * 0.08)),
    financingCashFlow: -Math.floor(baseRevenue * 0.1 * (1 - (year - 2022) * 0.03)),
  }));
}

/**
 * GET /api/stock/{symbol}/news?page=1&limit=20
 * News and announcements list
 */
export async function getNews(symbol: string): Promise<StockDocument[]> {
  await delay();
  const stockName = PROFILES[symbol]?.name ?? '该股';
  return [
    {
      id: '1',
      title: `${stockName}发布2025年年度报告`,
      type: 'announcement',
      publishTime: '2026-04-28 19:30',
      source: '巨潮资讯',
      summary: `公司2025年实现营收同比增长8.5%，净利润同比增长12.3%，符合市场预期。`,
      content: '',
      sentiment: 'positive',
      risks: [],
    },
    {
      id: '2',
      title: `${stockName}获得机构增持评级`,
      type: 'report',
      publishTime: '2026-04-25 09:15',
      source: '券商研报',
      summary: `多家券商维持"买入"评级，目标价上调15%，看好长期增长潜力。`,
      content: '',
      sentiment: 'positive',
      risks: ['估值偏高', '宏观经济下行'],
    },
    {
      id: '3',
      title: `${stockName}一季度经营数据点评`,
      type: 'news',
      publishTime: '2026-04-20 10:22',
      source: '财联社',
      summary: `一季度销量稳步增长，市场份额进一步提升，成本控制效果显现。`,
      content: '',
      sentiment: 'neutral',
      risks: ['原材料价格波动'],
    },
    {
      id: '4',
      title: `行业政策利好${stockName}所在板块`,
      type: 'news',
      publishTime: '2026-04-15 14:05',
      source: '证券时报',
      summary: `国务院出台支持行业发展新政策，预计将为公司带来新增量机会。`,
      content: '',
      sentiment: 'positive',
      risks: [],
    },
  ];
}

/**
 * POST /api/stock/{symbol}/analyze
 * Generate AI analysis, returns structured JSON
 */
export async function getAIAnalysis(symbol: string): Promise<AIAnalysis> {
  await delay(500, 1200);
  const stockName = PROFILES[symbol]?.name ?? '该股';
  return {
    summary: `${stockName}当前估值处于历史中枢偏上位置，基本面稳健，机构持仓稳定。`,
    score: 78,
    style: '稳健成长型',
    companyOverview: `${stockName}是中国高端白酒行业的绝对龙头，主营白酒生产与销售，拥有强大的品牌护城河和定价权。公司位于行业金字塔顶端，市场占有率领先。`,
    marketPerformance: '近5日股价上涨3.2%，成交量较前期有所放大，北向资金持续净流入，技术面呈多头排列，MACD金叉确认。',
    financialPerformance: '最近一年营收同比增长15.3%，净利润增长18.7%，毛利率稳定在75%以上，ROE保持在25%以上，现金流充裕。',
    valuationAnalysis: '当前PE 28.5x，高于行业中位数22x，但考虑到品牌溢价和盈利能力，估值仍在合理区间。PB 8.2x，处于历史中位水平。',
    newsDigest: '近期公司发布年度报告，业绩超市场预期。多家券商发布研报给予"买入"评级，目标价上调。行业政策面偏暖。',
    highlights: [
      '连续多年ROE保持在20%以上',
      '现金流充裕，分红率稳定',
      '行业龙头地位稳固',
    ],
    risks: [
      '估值水平偏高，PE处于历史70%分位',
      '宏观经济波动可能影响终端需求',
    ],
    conclusion: '适合长期配置，建议逢低分批建仓，短期注意估值回调风险。',
  };
}

/**
 * POST /api/stock/{symbol}/report
 * Generate full markdown report
 */
export async function getAIReport(symbol: string): Promise<AIReport> {
  await delay(600, 1500);
  const stockName = PROFILES[symbol]?.name ?? '该股';
  return {
    sections: [
      {
        title: '投资摘要',
        content: `${stockName}是中国高端白酒行业的绝对龙头，拥有强大的品牌护城河和定价权。公司财务指标稳健，现金流充沛，是A股市场少有的兼具成长性与防御性的核心资产。`,
      },
      {
        title: '业务分析',
        content: '公司主营茅台酒及系列酒的生产与销售。茅台酒产能受地理环境和工艺周期限制，稀缺性支撑长期价值。系列酒成为新增长点，渠道改革持续推进。',
      },
      {
        title: '财务分析',
        content: '2025年营收增长8.5%，净利润增长12.3%。毛利率维持91%高位，净利率52%。经营性现金流净额远超净利润，盈利质量优异。',
      },
      {
        title: '估值分析',
        content: '当前PE 28.5x，PB 9.2x，对应PEG约1.5。估值处于历史中枢偏上，但考虑到永续增长属性和确定性溢价，估值具备一定支撑。',
      },
      {
        title: '风险提示',
        content: '1) 消费复苏不及预期；2) 政策风险（消费税改革）；3) 渠道库存波动；4) 估值回调风险。',
      },
      {
        title: '投资建议',
        content: '给予"增持"评级，目标价对应2026年PE 30x。建议长期投资者逢低布局，短期交易者注意节奏。',
      },
    ],
    generatedAt: '2026-05-03 15:00:00',
  };
}

/**
 * GET /api/system/status
 * AKShare / AI service health
 */
/**
 * GET /api/stock/{symbol}/dividends
 * Dividend/split history
 */
export async function getDividends(_symbol: string): Promise<DividendRecord[]> {
  await delay();
  return [
    { year: 2025, dividendPerShare: 3.80, bonusShares: 0, reservePerShare: 0, exDate: '2025-06-28', recordDate: '2025-06-27' },
    { year: 2024, dividendPerShare: 3.50, bonusShares: 0, reservePerShare: 0, exDate: '2024-06-30', recordDate: '2024-06-29' },
    { year: 2023, dividendPerShare: 3.20, bonusShares: 0, reservePerShare: 0, exDate: '2023-06-25', recordDate: '2023-06-24' },
    { year: 2022, dividendPerShare: 2.90, bonusShares: 0, reservePerShare: 0, exDate: '2022-06-26', recordDate: '2022-06-25' },
  ];
}

export async function getSystemStatus(): Promise<SystemStatus> {
  await delay(100, 300);
  return {
    akshare: 'online',
    aiService: 'online',
    dataSource: 'AKShare',
    lastUpdate: '2026-05-03 15:00:00',
  };
}
