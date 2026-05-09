const BASE = '/api';
const LOCAL_BACKEND_BASE = 'http://127.0.0.1:1335/api';
const TOKEN_KEY = 'stock_auth_token';

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setAuthToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

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

function withAuthHeaders(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return { ...init, headers };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, withAuthHeaders(init));
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) setAuthToken('');
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    return await fetchJson<T>(url, init);
  } catch (error) {
    const fallbackUrl = localBackendUrl(url);
    if (!fallbackUrl || !shouldRetryWithLocalBackend(error)) throw error;
    return fetchJson<T>(fallbackUrl, init);
  }
}
