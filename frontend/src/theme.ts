// Theme preference: light / dark / system (default system).
//
// The *preference* is persisted in localStorage; the *resolved* theme
// ('light'|'dark') is written to <html data-theme> so CSS can switch tokens.
// A no-flash bootstrap script in index.html sets data-theme before first paint;
// this module keeps it in sync at runtime and follows the OS when in 'system'.

export type ThemePref = 'light' | 'dark' | 'system';

export const THEME_KEY = 'bs_theme';

const darkMql = (): MediaQueryList =>
  window.matchMedia('(prefers-color-scheme: dark)');

export function getStoredPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* localStorage unavailable */
  }
  return 'system';
}

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return darkMql().matches ? 'dark' : 'light';
  return pref;
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

export function storePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* ignore */
  }
}

// Re-apply when the OS scheme changes *and* the user is following the system.
// Call once at startup. Returns an unsubscribe function.
export function initSystemThemeListener(): () => void {
  const mql = darkMql();
  const onChange = () => {
    if (getStoredPref() === 'system') applyTheme('system');
  };
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
