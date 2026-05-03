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
  DownloadStatus,
  SingleDownloadProgress,
  DataStocksResponse,
  StockStats,
} from '../../types';

const BASE = '/api';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
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
): Promise<KLineData[]> {
  return request(`${BASE}/stock/${symbol}/kline?period=${period}`);
}

export async function getFinancials(symbol: string): Promise<FinancialStatement[]> {
  return request(`${BASE}/stock/${symbol}/financials`);
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
              onDone();
              return;
            } else if (event.field === '__error__') {
              onError(event.value);
              return;
            } else {
              onField(event.field, event.value);
            }
          } catch {
            // skip malformed lines
          }
        }
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
): Promise<DataStocksResponse> {
  return request(`${BASE}/system/data-stocks?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}`);
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

export async function downloadStockData(symbol: string): Promise<{ status: string; symbol: string; name?: string; message?: string }> {
  return request(`${BASE}/system/data/download/${symbol}`, { method: 'POST' });
}

export async function refreshAllData(): Promise<{ status: string; total?: number }> {
  return request(`${BASE}/system/data-refresh-all`, { method: 'POST' });
}

export async function deleteStockData(symbol: string): Promise<{ status: string; message: string }> {
  return request(`${BASE}/system/data/${symbol}`, { method: 'DELETE' });
}

export async function getIndustries(): Promise<{ items: { name: string; code: string; count: number }[] }> {
  return request(`${BASE}/system/industries`);
}

export async function getIndustryStocks(industry: string): Promise<{ industry: string; items: { code: string; name: string }[] }> {
  return request(`${BASE}/system/industry/${encodeURIComponent(industry)}/stocks`);
}
