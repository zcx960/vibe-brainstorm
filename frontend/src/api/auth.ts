import { http } from './client';
import type { AuthResponse, User } from '../types';

// POST /api/auth/register -> {token, user} (201). 409 if username taken.
export function register(
  username: string,
  password: string,
  displayName?: string,
): Promise<AuthResponse> {
  return http.post<AuthResponse>('/auth/register', {
    username,
    password,
    ...(displayName ? { display_name: displayName } : {}),
  });
}

// POST /api/auth/login -> {token, user}. 401 on bad creds.
export function login(
  username: string,
  password: string,
): Promise<AuthResponse> {
  return http.post<AuthResponse>('/auth/login', { username, password });
}

// GET /api/auth/me -> user.
export function me(): Promise<User> {
  return http.get<User>('/auth/me');
}
