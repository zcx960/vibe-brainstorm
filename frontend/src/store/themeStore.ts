import { useEffect, useState } from 'react';
import { create } from 'zustand';
import {
  applyTheme,
  getStoredPref,
  resolveTheme,
  storePref,
  type ThemePref,
} from '../theme';

interface ThemeState {
  pref: ThemePref;
  setPref: (pref: ThemePref) => void;
}

// Reflects the persisted preference and applies it to <html data-theme> on every
// change. Initial application happens in the index.html no-flash bootstrap.
export const useThemeStore = create<ThemeState>((set) => ({
  pref: getStoredPref(),
  setPref: (pref) => {
    storePref(pref);
    applyTheme(pref);
    set({ pref });
  },
}));

// Resolved 'light' | 'dark' for the current preference, reactive to BOTH the
// stored preference and (when following the system) OS scheme changes. Used to
// drive React Flow's `colorMode` so the minimap/controls/background match.
export function useResolvedTheme(): 'light' | 'dark' {
  const pref = useThemeStore((s) => s.pref);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return resolveTheme(pref);
}
