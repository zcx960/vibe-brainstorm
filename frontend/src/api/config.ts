import { http } from './client';
import type { Provider, Mode, Defaults } from '../types';

export function getProviders(): Promise<Provider[]> {
  return http
    .get<{ providers: Provider[] }>('/config/providers')
    .then((r) => r.providers);
}

export function getModes(): Promise<Mode[]> {
  return http.get<{ modes: Mode[] }>('/config/modes').then((r) => r.modes);
}

export function getDefaults(): Promise<Defaults> {
  return http.get<Defaults>('/config/defaults');
}
