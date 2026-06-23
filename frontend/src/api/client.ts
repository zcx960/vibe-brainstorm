// Tiny fetch wrapper. Throws on non-2xx, parses JSON, handles 204.

export const API_BASE = '/api';

// localStorage / sessionStorage keys (kept here so every caller agrees).
export const TOKEN_KEY = 'bs_token';
const CLIENT_ID_KEY = 'bs_client_id';

// Window event broadcast when the server rejects our token (401). The app
// listens for this to drop back to the login screen. We use an event instead
// of importing authStore so client.ts never depends on the store (no cycle:
// authStore imports the API, the API must not import authStore).
export const UNAUTHORIZED_EVENT = 'bs:unauthorized';

export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`API ${status}: ${body || '(no body)'}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Stable per-tab client id, persisted in sessionStorage so it survives reloads
 * within the same tab but differs between tabs. Sent as `X-Client-Id` on every
 * request so the backend can attribute graph mutations to an originating tab.
 */
export function getClientId(): string {
  try {
    let id = sessionStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage unavailable (e.g. privacy mode) — fall back to a volatile id.
    return crypto.randomUUID();
  }
}

/**
 * Headers that authenticate / identify the caller. Shared so the streaming
 * brainstorm endpoint (which uses fetch directly, bypassing `request`) injects
 * the exact same Authorization + X-Client-Id as everything else.
 */
export function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'X-Client-Id': getClientId() };
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Paths that must NOT trigger the global 401 -> logout handling: a failed
// login/register is an expected inline error, not a session expiry.
function isAuthEntryPath(path: string): boolean {
  return path === '/auth/login' || path === '/auth/register';
}

function handleUnauthorized(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, init);

  if (!res.ok) {
    // Session expired / token rejected: clear it and notify the app, except
    // for the login/register calls themselves (those surface inline errors).
    if (res.status === 401 && !isAuthEntryPath(path)) {
      handleUnauthorized();
    }
    let text = '';
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, text);
  }

  // 204 No Content (or empty body) -> resolve with undefined.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
};
