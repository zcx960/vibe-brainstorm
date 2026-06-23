// Self-contained admin API client. Stores the admin token in sessionStorage
// (separate from the user `bs_token`) and attaches it as a Bearer header. On
// any 401 the token is cleared so the UI drops back to the admin login card.
//
// Intentionally standalone: the admin mini-app must NOT pull in the user auth
// store or the canvas/collab stores.

const ADMIN_API_BASE = '/api/admin';
export const ADMIN_TOKEN_KEY = 'bs_admin_token';

export interface AdminProvider {
  id: string;
  key: string;
  name: string;
  base_url: string;
  models: string[];
  image_models: string[];
  enabled: boolean;
  has_key: boolean;
}

// Shape sent to create. `api_key` optional; `enabled` optional.
export interface ProviderCreate {
  key: string;
  name: string;
  base_url: string;
  api_key?: string;
  models: string[];
  image_models?: string[];
  enabled?: boolean;
}

// Partial update. Omitting / leaving `api_key` empty keeps the existing key.
export interface ProviderUpdate {
  name?: string;
  base_url?: string;
  api_key?: string;
  models?: string[];
  image_models?: string[];
  enabled?: boolean;
}

export class AdminApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Admin API ${status}: ${body || '(no body)'}`);
    this.name = 'AdminApiError';
    this.status = status;
    this.body = body;
  }
}

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setAdminToken(token: string): void {
  try {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearAdminToken(): void {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getAdminToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${ADMIN_API_BASE}${path}`, init);

  if (!res.ok) {
    // Any 401 -> drop the (now invalid / expired) admin token.
    if (res.status === 401) clearAdminToken();
    let text = '';
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    throw new AdminApiError(res.status, text);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// POST /api/admin/login {password} -> {token}. 401 on wrong password.
// Stores the token on success and returns it.
export async function adminLogin(password: string): Promise<string> {
  const { token } = await request<{ token: string }>('POST', '/login', {
    password,
  });
  setAdminToken(token);
  return token;
}

// GET /api/admin/providers -> {providers:[...]}
export function listProviders(): Promise<AdminProvider[]> {
  return request<{ providers: AdminProvider[] }>('GET', '/providers').then(
    (r) => r.providers,
  );
}

// POST /api/admin/providers -> provider (201; 409 if key exists)
export function createProvider(body: ProviderCreate): Promise<AdminProvider> {
  return request<AdminProvider>('POST', '/providers', body);
}

// PATCH /api/admin/providers/{id} -> provider
export function updateProvider(
  id: string,
  body: ProviderUpdate,
): Promise<AdminProvider> {
  return request<AdminProvider>('PATCH', `/providers/${id}`, body);
}

// DELETE /api/admin/providers/{id} -> 204
export function deleteProvider(id: string): Promise<void> {
  return request<void>('DELETE', `/providers/${id}`);
}
