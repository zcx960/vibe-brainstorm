import { create } from 'zustand';
import { TOKEN_KEY } from '../api/client';
import { login as apiLogin, register as apiRegister, me as apiMe } from '../api/auth';
import type { User } from '../types';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

interface AuthState {
  token: string | null;
  user: User | null;
  // false until the initial token-hydration attempt has resolved. The app
  // shows a loading state until this flips true.
  ready: boolean;

  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  logout: () => void;
  // Hydrate `user` from the persisted token via GET /me. Used on boot and on
  // the `bs:unauthorized` recovery path.
  loadMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: readToken(),
  user: null,
  ready: false,

  login: async (username, password) => {
    const { token, user } = await apiLogin(username, password);
    writeToken(token);
    set({ token, user, ready: true });
  },

  register: async (username, password, displayName) => {
    const { token, user } = await apiRegister(username, password, displayName);
    writeToken(token);
    set({ token, user, ready: true });
  },

  logout: () => {
    clearToken();
    set({ token: null, user: null, ready: true });
  },

  loadMe: async () => {
    const token = readToken();
    if (!token) {
      set({ token: null, user: null, ready: true });
      return;
    }
    try {
      const user = await apiMe();
      set({ token, user, ready: true });
    } catch {
      // Token rejected/expired -> drop it and fall through to the login gate.
      clearToken();
      set({ token: null, user: null, ready: true });
    }
  },
}));
