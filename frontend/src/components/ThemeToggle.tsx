import { useThemeStore } from '../store/themeStore';
import type { ThemePref } from '../theme';

const OPTIONS: { value: ThemePref; icon: string; label: string }[] = [
  { value: 'light', icon: '☀', label: '亮色' },
  { value: 'dark', icon: '🌙', label: '暗色' },
  { value: 'system', icon: '🖥', label: '跟随系统' },
];

export function ThemeToggle() {
  const pref = useThemeStore((s) => s.pref);
  const setPref = useThemeStore((s) => s.setPref);

  return (
    <div className="theme-toggle" role="group" aria-label="主题模式">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          data-theme-option={o.value}
          className={`theme-toggle__btn${
            pref === o.value ? ' theme-toggle__btn--active' : ''
          }`}
          title={o.label}
          aria-label={o.label}
          aria-pressed={pref === o.value}
          onClick={() => setPref(o.value)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
