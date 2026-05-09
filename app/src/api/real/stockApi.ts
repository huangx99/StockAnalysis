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
  AuthTokenResponse,
  UserPublic,
  Watchlist,
  WatchlistItem,
  CalculationTemplate,
  TemplateType,
  SectorOverviewResponse,
  SectorBidAskResponse,
  NewsSentimentOverview,
  NewsSentimentItem,
  SentimentTrend,
  TopicCluster,
  PaginatedNewsFeed,
} from '../../types';

const BASE = '/api';

export { getAuthToken, setAuthToken, request } from './client';
import { request } from './client';

export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  return request(`${BASE}/search?q=${encodeURIComponent(query)}`);
}

export async function getStockProfile(symbol: string, refreshToken?: number): Promise<StockProfile> {
  const suffix = refreshToken ? `?_=${refreshToken}` : '';
  return request(`${BASE}/stock/${symbol}/profile${suffix}`);
}

export async function getKLineData(
  symbol: string,
  period: 'day' | 'week' | 'month' | '1min' | '5min' | '15min' | '30min' | '60min' = 'day',
  limit = 0,
  refreshToken?: number,
): Promise<KLineData[]> {
  const params = new URLSearchParams({ period });
  if (limit > 0) params.set('limit', String(limit));
  if (refreshToken) params.set('_', String(refreshToken));
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

export async function downloadStockData(symbol: string, dataTypes?: string[]): Promise<{ status: string; symbol: string; name?: string; message?: string; stats?: Record<string, number> }> {
  const query = new URLSearchParams();
  dataTypes?.forEach((dataType) => query.append('dataTypes', dataType));
  const suffix = query.toString() ? `?${query}` : '';
  return request(`${BASE}/system/data/download/${symbol}${suffix}`, { method: 'POST' });
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

export async function login(account: string, password: string): Promise<AuthTokenResponse> {
  return request(`${BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ account, password }),
  });
}

export async function register(username: string, email: string, password: string): Promise<AuthTokenResponse> {
  return request(`${BASE}/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });
}

export async function getCurrentUser(): Promise<UserPublic> {
  return request(`${BASE}/auth/me`);
}

export async function updateCurrentUserProfile(body: { email?: string }): Promise<UserPublic> {
  return request(`${BASE}/auth/me`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function changeCurrentUserPassword(currentPassword: string, newPassword: string): Promise<{ status: string }> {
  return request(`${BASE}/auth/change-password`, {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function getUsers(): Promise<UserPublic[]> {
  return request(`${BASE}/admin/users`);
}

export async function updateUser(userId: string, body: Partial<Pick<UserPublic, 'role' | 'isActive'>>): Promise<UserPublic> {
  return request(`${BASE}/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function getWatchlists(): Promise<Watchlist[]> {
  return request(`${BASE}/watchlists`);
}

export async function createWatchlist(name: string, description = ''): Promise<Watchlist> {
  return request(`${BASE}/watchlists`, {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function addWatchlistItem(body: {
  stockCode: string;
  stockName?: string;
  market?: string;
  note?: string;
  tags?: string[];
}): Promise<WatchlistItem> {
  return request(`${BASE}/watchlist/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateWatchlistItem(itemId: string, body: { note?: string; tags?: string[]; sortOrder?: number }): Promise<WatchlistItem> {
  return request(`${BASE}/watchlist/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteWatchlistItem(itemId: string): Promise<{ status: string }> {
  return request(`${BASE}/watchlist/items/${itemId}`, { method: 'DELETE' });
}

export async function removeWatchlistSymbol(stockCode: string): Promise<{ status: string }> {
  return request(`${BASE}/watchlist/symbol/${stockCode}`, { method: 'DELETE' });
}

export async function checkWatchlistSymbol(stockCode: string): Promise<{ isFavorite: boolean; items: WatchlistItem[] }> {
  return request(`${BASE}/watchlist/check/${stockCode}`);
}

export async function getTemplates(): Promise<CalculationTemplate[]> {
  return request(`${BASE}/templates`);
}

export async function createTemplate(body: {
  name: string;
  description?: string;
  templateType?: TemplateType;
  category?: string;
  content?: Record<string, unknown>;
}): Promise<CalculationTemplate> {
  return request(`${BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateTemplate(templateId: string, body: Partial<CalculationTemplate>): Promise<CalculationTemplate> {
  return request(`${BASE}/templates/${templateId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteTemplate(templateId: string): Promise<{ status: string }> {
  return request(`${BASE}/templates/${templateId}`, { method: 'DELETE' });
}

export async function copyTemplate(templateId: string): Promise<CalculationTemplate> {
  return request(`${BASE}/templates/${templateId}/copy`, { method: 'POST' });
}

// ── Sector Analysis ──

export async function getSectorOverview(): Promise<SectorOverviewResponse> {
  return request(`${BASE}/sector/overview`);
}

export async function getSectorBidAsk(boardName: string, codes?: string): Promise<SectorBidAskResponse> {
  const qs = codes ? `?codes=${encodeURIComponent(codes)}` : '';
  return request(`${BASE}/sector/${encodeURIComponent(boardName)}/bidask${qs}`);
}

// ── News Sentiment ──

export async function getNewsSentimentOverview(): Promise<NewsSentimentOverview> {
  return request(`${BASE}/news/sentiment/overview`);
}

export async function getNewsSentimentFeed(params?: {
  page?: number;
  pageSize?: number;
  sentiment?: string;
  topic?: string;
  source?: string;
}): Promise<PaginatedNewsFeed> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  if (params?.sentiment) query.set('sentiment', params.sentiment);
  if (params?.topic) query.set('topic', params.topic);
  if (params?.source) query.set('source', params.source);
  const qs = query.toString();
  return request(`${BASE}/news/sentiment/feed${qs ? `?${qs}` : ''}`);
}

export async function getNewsSentimentTrends(days = 30): Promise<SentimentTrend[]> {
  return request(`${BASE}/news/sentiment/trends?days=${days}`);
}

export async function getNewsSentimentTopics(): Promise<TopicCluster[]> {
  return request(`${BASE}/news/sentiment/topics`);
}

export async function refreshNewsSentiment(): Promise<{ ok: boolean; overview?: NewsSentimentOverview; error?: string }> {
  return request(`${BASE}/news/sentiment/refresh`, { method: 'POST' });
}

export async function getNewsSentimentByStock(symbol: string): Promise<NewsSentimentItem[]> {
  return request(`${BASE}/news/sentiment/stock/${symbol}`);
}

export async function searchNewsRealtime(keyword: string, limit?: number): Promise<{items: NewsSentimentItem[], total: number, keyword: string}> {
  const query = new URLSearchParams();
  query.set('keyword', keyword);
  if (limit) query.set('limit', String(limit));
  return request(`${BASE}/news/sentiment/search?${query.toString()}`);
}

export async function searchNewsFiltered(keyword: string, conditionTree?: import('@/types').ConditionNode | null, limit?: number): Promise<{items: NewsSentimentItem[], total: number, keyword: string}> {
  return request(`${BASE}/news/sentiment/search`, {
    method: 'POST',
    body: JSON.stringify({ keyword, conditionTree: conditionTree || null, limit: limit || 30 }),
  });
}

// ── Monitor ──

export async function getMonitorRules(): Promise<import('@/types').MonitorRule[]> {
  return request(`${BASE}/monitor/rules`);
}

export async function createMonitorRule(data: Partial<import('@/types').MonitorRule>): Promise<import('@/types').MonitorRule> {
  return request(`${BASE}/monitor/rules`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateMonitorRule(id: string, data: Partial<import('@/types').MonitorRule>): Promise<import('@/types').MonitorRule> {
  return request(`${BASE}/monitor/rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteMonitorRule(id: string): Promise<{ok: boolean}> {
  return request(`${BASE}/monitor/rules/${id}`, { method: 'DELETE' });
}

export async function getMonitorHits(ruleId?: string, limit?: number): Promise<import('@/types').MonitorHit[]> {
  const query = new URLSearchParams();
  if (ruleId) query.set('ruleId', ruleId);
  if (limit) query.set('limit', String(limit));
  const qs = query.toString();
  return request(`${BASE}/monitor/hits${qs ? `?${qs}` : ''}`);
}

export async function testMonitorRule(id: string): Promise<{hits: import('@/types').MonitorHit[], total: number, emailSent: boolean}> {
  return request(`${BASE}/monitor/rules/${id}/test`, { method: 'POST' });
}

export async function getMonitorStats(): Promise<import('@/types').MonitorStats> {
  return request(`${BASE}/monitor/stats`);
}

export async function generateMonitorRule(description: string): Promise<{
  ok: boolean; searchKeywords?: string[]; conditionTree?: import('@/types').ConditionNode; error?: string
}> {
  return request(`${BASE}/monitor/rules/generate`, {
    method: 'POST',
    body: JSON.stringify({ description }),
  });
}
