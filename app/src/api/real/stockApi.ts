import type {
  StockSearchResult,
  StockProfile,
  KLineData,
  FinancialStatement,
  FinancialPeriodMetrics,
  FinancialSummary,
  FinancialStatementsResponse,
  DividendRecord,
  AIAnalysis,
  StockDocument,
  AIReport,
  SystemStatus,
  DownloadStatus,
  SingleDownloadProgress,
  DataStocksResponse,
  StockStats,
  NewsAnalysis,
  MarketDownloadStatus,
  MarketDataSummary,
  ScreenerRequest,
  ScreenerResponse,
  ScreenerInsight,
  FormulaFieldMeta,
  FormulaGenerateResponse,
  IndustryListResponse,
  IndustryCompareResponse,
  BacktestRequest,
  BacktestResponse,
} from '../../types';

const BASE = '/api';
const LOCAL_BACKEND_BASE = 'http://127.0.0.1:1335/api';

function shouldRetryWithLocalBackend(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('API error 404') ||
    message.includes('API_NOT_FOUND')
  );
}

function localBackendUrl(url: string) {
  if (!url.startsWith(BASE)) return null;
  if (typeof window !== 'undefined' && window.location.origin === 'http://127.0.0.1:1335') return null;
  return `${LOCAL_BACKEND_BASE}${url.slice(BASE.length)}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    return await fetchJson<T>(url, init);
  } catch (error) {
    const fallbackUrl = localBackendUrl(url);
    if (!fallbackUrl || !shouldRetryWithLocalBackend(error)) throw error;
    return fetchJson<T>(fallbackUrl, init);
  }
}

export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  return request(`${BASE}/search?q=${encodeURIComponent(query)}`);
}

export async function getStockProfile(symbol: string): Promise<StockProfile> {
  return request(`${BASE}/stock/${symbol}/profile`);
}

export async function getKLineData(
  symbol: string,
  period: 'day' | 'week' | 'month' = 'day',
  limit = 0,
): Promise<KLineData[]> {
  const params = new URLSearchParams({ period });
  if (limit > 0) params.set('limit', String(limit));
  return request(`${BASE}/stock/${symbol}/kline?${params}`);
}

export async function getFinancials(symbol: string): Promise<FinancialStatement[]> {
  return request(`${BASE}/stock/${symbol}/financials`);
}

export async function getFinancialPeriods(
  symbol: string,
  period: 'quarter' | 'annual' = 'quarter',
  limit = 20,
): Promise<FinancialPeriodMetrics[]> {
  const params = new URLSearchParams({ period, limit: String(limit) });
  return request(`${BASE}/stock/${symbol}/financial/periods?${params}`);
}

export async function getFinancialSummary(symbol: string): Promise<FinancialSummary> {
  return request(`${BASE}/stock/${symbol}/financial/summary`);
}

export async function getFinancialStatements(
  symbol: string,
  type: 'income' | 'balance' | 'cashflow',
  period: 'quarter' | 'annual' = 'quarter',
): Promise<FinancialStatementsResponse> {
  const params = new URLSearchParams({ type, period });
  return request(`${BASE}/stock/${symbol}/financial/statements?${params}`);
}

export async function getNews(symbol: string): Promise<StockDocument[]> {
  return request(`${BASE}/stock/${symbol}/news`);
}

export async function getStockStats(symbol: string): Promise<StockStats> {
  return request(`${BASE}/stock/${symbol}/stats`);
}

export async function getDividends(symbol: string): Promise<DividendRecord[]> {
  return request(`${BASE}/stock/${symbol}/dividends`);
}

export async function getAIAnalysis(symbol: string): Promise<AIAnalysis> {
  return request(`${BASE}/stock/${symbol}/analyze`, { method: 'POST' });
}

export async function getSavedAIAnalysis(symbol: string): Promise<AIAnalysis | null> {
  return request(`${BASE}/stock/${symbol}/analyze/saved`);
}

export function streamAIAnalysis(
  symbol: string,
  onField: (field: string, value: unknown) => void,
  onDone: () => void,
  onError: (error: string) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/stock/${symbol}/analyze/stream`, {
        method: 'POST',
        signal: controller.signal,
      });
      if (!res.ok) {
        onError(`API error ${res.status}`);
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedField = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.field === '__done__') {
              if (!receivedField) {
                onError('AI 未返回有效内容，请检查模型配置或稍后重试');
                return;
              }
              onDone();
              return;
            } else if (event.field === '__error__') {
              onError(String(event.value || 'AI 分析失败'));
              return;
            } else {
              receivedField = true;
              onField(event.field, event.value);
            }
          } catch {
            // skip malformed lines
          }
        }
      }
      if (!receivedField) {
        onError('AI 连接已结束，但没有收到分析内容');
        return;
      }
      onDone();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      onError(err instanceof Error ? err.message : 'Streaming failed');
    }
  })();

  return () => controller.abort();
}

export async function getAIReport(symbol: string): Promise<AIReport> {
  return request(`${BASE}/stock/${symbol}/report`, { method: 'POST' });
}

export async function getSystemStatus(): Promise<SystemStatus> {
  return request(`${BASE}/system/status`);
}

export interface AIConfig {
  provider: string
  apiKeyMasked: string
  model: string
  baseUrl: string
  configured: boolean
}

export async function getAIConfig(): Promise<AIConfig> {
  return request(`${BASE}/system/ai-config`);
}

export async function saveAIConfig(config: {
  provider: string
  apiKey: string
  model: string
  baseUrl?: string
}): Promise<AIConfig> {
  return request(`${BASE}/system/ai-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}


export async function getIndustryList(): Promise<IndustryListResponse> {
  return request(`${BASE}/industry/industries`);
}

export async function rebuildIndustrySnapshot(): Promise<IndustryListResponse> {
  return request(`${BASE}/industry/industries/rebuild`, { method: 'POST' });
}

export async function getIndustryCompare(params: {
  industry: string;
  period?: 'annual' | 'quarter';
  q?: string;
  completeOnly?: boolean;
  limit?: number;
}): Promise<IndustryCompareResponse> {
  const qs = new URLSearchParams({ industry: params.industry });
  if (params.period) qs.set('period', params.period);
  if (params.q) qs.set('q', params.q);
  if (params.completeOnly != null) qs.set('completeOnly', String(params.completeOnly));
  if (params.limit) qs.set('limit', String(params.limit));
  return request(`${BASE}/industry/compare?${qs}`);
}


export async function runBacktestValidation(params: BacktestRequest): Promise<BacktestResponse> {
  return request(`${BASE}/backtest/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

// Data management

export async function getDataStatus(): Promise<DownloadStatus> {
  return request(`${BASE}/system/data-status`);
}

export async function getSingleDownloadStatus(): Promise<SingleDownloadProgress> {
  return request(`${BASE}/system/data/single-status`);
}

export async function getDataStocks(
  page = 1,
  pageSize = 50,
  query = '',
  missingOnly = false,
): Promise<DataStocksResponse> {
  return request(`${BASE}/system/data-stocks?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}&missingOnly=${missingOnly}`);
}

export async function rebuildDataStocks(
  page = 1,
  pageSize = 50,
  query = '',
  missingOnly = false,
): Promise<DataStocksResponse> {
  return request(`${BASE}/system/data-stocks/rebuild?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}&missingOnly=${missingOnly}`, { method: 'POST' });
}

export async function startDataDownload(): Promise<{ status: string; total?: number }> {
  return request(`${BASE}/system/data-download`, { method: 'POST' });
}

export async function stopDataDownload(): Promise<{ status: string }> {
  return request(`${BASE}/system/data-stop`, { method: 'POST' });
}

export async function resetDataStatus(): Promise<{ status: string }> {
  return request(`${BASE}/system/data-reset`, { method: 'POST' });
}

export async function refreshStockData(symbol: string): Promise<{ status: string; message: string }> {
  return request(`${BASE}/system/data/refresh/${symbol}`, { method: 'POST' });
}

export async function refreshMissingStockData(symbol: string): Promise<{ status: string; message: string; missingDataTypes?: string[]; fixedDataTypes?: string[]; stillMissingDataTypes?: string[]; stats?: Record<string, number> }> {
  return request(`${BASE}/system/data/refresh-missing/${symbol}`, { method: 'POST' });
}

export async function downloadStockData(symbol: string): Promise<{ status: string; symbol: string; name?: string; message?: string }> {
  return request(`${BASE}/system/data/download/${symbol}`, { method: 'POST' });
}

export async function refreshAllData(): Promise<{ status: string; total?: number; message?: string }> {
  return request(`${BASE}/system/data-refresh-all`, { method: 'POST' });
}

export async function deleteStockData(symbol: string): Promise<{ status: string; message: string }> {
  return request(`${BASE}/system/data/${symbol}`, { method: 'DELETE' });
}

export async function getIndustries(): Promise<{ items: { name: string; code: string; count: number }[] }> {
  return request(`${BASE}/system/industries`);
}

export async function refreshNews(symbol: string): Promise<{ new_count: number; total: number }> {
  return request(`${BASE}/stock/${symbol}/news/refresh`, { method: 'POST' });
}

export async function analyzeNewsItem(
  symbol: string,
  title: string,
  content: string,
  url: string = '',
): Promise<NewsAnalysis> {
  return request(`${BASE}/stock/${symbol}/news/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, url }),
  });
}

export async function getIndustryStocks(industry: string): Promise<{ industry: string; items: { code: string; name: string }[] }> {
  return request(`${BASE}/system/industry/${encodeURIComponent(industry)}/stocks`);
}


export interface SectorInfo {
  name: string;
  strength_score: number;
  trend: 'up' | 'down' | 'flat';
  is_mainline: boolean;
  reason: string;
}

export interface LeaderInfo {
  code: string;
  name: string;
  sector: string;
  board_height: number;
  role: '总龙头' | '板块龙头' | '跟风';
  strength: number;
}

export interface MarketAIAnalysis {
  summary: {
    stage: string;
    emotion_score: number;
    risk_level: '低' | '中' | '高';
    confidence: number;
  };
  conclusion: {
    one_line: string;
    reasoning: string[];
  };
  strategy: {
    can_do: string[];
    cannot_do: string[];
    watch_signals: string[];
  };
  mainline: {
    sectors: SectorInfo[];
    status: string;
  };
  leaders: LeaderInfo[];
  risk: {
    warnings: string[];
    anomalies: string[];
  };
  range?: { startDate: string; endDate: string; snapshotCount: number; omittedSnapshots: number };
  includedDataTypes?: string[];
  generatedAt?: string;
  aiStatus?: { available: boolean; message: string };
  rawSignals?: Record<string, unknown>;
}


export async function analyzeMarketData(params: {
  startDate: string;
  endDate: string;
  dataTypes?: string[];
  maxDays?: number;
}): Promise<MarketAIAnalysis> {
  return request(`${BASE}/market/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function getMarketDataStatus(): Promise<MarketDownloadStatus> {
  return request(`${BASE}/system/market-data/status`);
}

export async function getMarketTradeDates(params: { startDate: string; endDate: string }): Promise<{ items: string[] }> {
  const query = new URLSearchParams();
  query.set('startDate', params.startDate);
  query.set('endDate', params.endDate);
  return request(`${BASE}/system/market-data/trade-dates?${query}`);
}

export async function startMarketDataDownload(params?: { tradeDate?: string; startDate?: string; endDate?: string; dates?: string[] }): Promise<{ status: string; tradeDate?: string; tradeDates?: string[]; total?: number; normalizedNote?: string }> {
  const query = new URLSearchParams();
  if (params?.tradeDate) query.set('tradeDate', params.tradeDate);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  params?.dates?.forEach((date) => query.append('dates', date));
  const suffix = query.toString() ? `?${query}` : '';
  return request(`${BASE}/system/market-data/download${suffix}`, { method: 'POST' });
}

export async function pauseMarketDataDownload(): Promise<{ status: string }> {
  return request(`${BASE}/system/market-data/pause`, { method: 'POST' });
}

export async function resumeMarketDataDownload(): Promise<{ status: string }> {
  return request(`${BASE}/system/market-data/resume`, { method: 'POST' });
}

export async function cancelMarketDataDownload(): Promise<{ status: string }> {
  return request(`${BASE}/system/market-data/cancel`, { method: 'POST' });
}

export async function resetMarketDataStatus(): Promise<{ status: string }> {
  return request(`${BASE}/system/market-data/reset`, { method: 'POST' });
}

export async function getMarketDataSnapshots(): Promise<{ items: MarketDataSummary[] }> {
  return request(`${BASE}/system/market-data/snapshots`);
}

export async function deleteMarketData(tradeDate: string): Promise<{ status: string; message: string }> {
  return request(`${BASE}/system/market-data/${tradeDate}`, { method: 'DELETE' });
}

export async function getMarketDataDetail<T = unknown>(tradeDate: string, dataType: string): Promise<{ tradeDate: string; dataType: string; data: T | null; error?: string }> {
  return request(`${BASE}/system/market-data/${tradeDate}/${dataType}`);
}

export async function runScreener(params: ScreenerRequest): Promise<ScreenerResponse> {
  return request(`${BASE}/screener/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function getFormulaFields(): Promise<{ items: FormulaFieldMeta[] }> {
  return request(`${BASE}/screener/formula/fields`);
}

export async function validateFormula(formula: string): Promise<{ ok: boolean; message: string }> {
  return request(`${BASE}/screener/formula/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formula }),
  });
}

export async function generateFormula(description: string): Promise<FormulaGenerateResponse> {
  return request(`${BASE}/screener/formula/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
}

export async function generateScreenerAiInsight(
  params: ScreenerRequest,
  fetchLinks = false,
  forceRefresh = false,
): Promise<ScreenerInsight> {
  return request(`${BASE}/screener/insight/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ screenerRequest: params, fetchLinks, forceRefresh }),
  });
}
