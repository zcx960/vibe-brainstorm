import { useUiStore } from '../store/uiStore';

/**
 * Reusable mode + provider + model selectors driven by /api/config data in the
 * UI store. Providers that aren't available (missing API key on the backend)
 * are rendered disabled with a hint.
 */
export function ModeProviderSelectors() {
  const modes = useUiStore((s) => s.modes);
  const providers = useUiStore((s) => s.providers);
  const mode = useUiStore((s) => s.mode);
  const provider = useUiStore((s) => s.provider);
  const model = useUiStore((s) => s.model);
  const setMode = useUiStore((s) => s.setMode);
  const setProvider = useUiStore((s) => s.setProvider);
  const setModel = useUiStore((s) => s.setModel);

  const currentProvider = providers.find((p) => p.id === provider);
  const models = currentProvider?.models ?? [];

  return (
    <div className="selectors">
      <label className="field">
        <span className="field__label">脑爆模式</span>
        <select
          className="field__control"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          {modes.length === 0 && <option value="">（无）</option>}
          {modes.map((m) => (
            <option key={m.id} value={m.id} title={m.description}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">模型提供方</span>
        <select
          className="field__control"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          {providers.length === 0 && <option value="">（无）</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.available}>
              {p.name}
              {p.available ? '' : ' · 未配置密钥'}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">模型</span>
        <select
          className="field__control"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={models.length === 0}
        >
          {models.length === 0 && <option value="">（无）</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
