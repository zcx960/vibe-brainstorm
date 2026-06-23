import { useState } from 'react';
import {
  createProvider,
  updateProvider,
  AdminApiError,
  type AdminProvider,
  type ProviderCreate,
  type ProviderUpdate,
} from './adminApi';

interface ProviderFormProps {
  provider: AdminProvider | null;
  onClose: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
}

function parseModels(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ProviderForm({
  provider,
  onClose,
  onSaved,
  onUnauthorized,
}: ProviderFormProps) {
  const isEdit = provider !== null;

  const [name, setName] = useState(provider?.name ?? '');
  const [key, setKey] = useState(provider?.key ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [modelsText, setModelsText] = useState(
    (provider?.models ?? []).join(', '),
  );
  const [imageModelsText, setImageModelsText] = useState(
    (provider?.image_models ?? []).join(', '),
  );
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedKey = key.trim();
    const trimmedBaseUrl = baseUrl.trim();
    const models = parseModels(modelsText);
    const imageModels = parseModels(imageModelsText);

    if (!trimmedName || !trimmedKey || !trimmedBaseUrl) {
      setError('请填写名称、标识和 Base URL');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit && provider) {
        const body: ProviderUpdate = {
          name: trimmedName,
          base_url: trimmedBaseUrl,
          models,
          image_models: imageModels,
          enabled,
        };
        if (apiKey.trim()) body.api_key = apiKey.trim();
        await updateProvider(provider.id, body);
      } else {
        const body: ProviderCreate = {
          key: trimmedKey,
          name: trimmedName,
          base_url: trimmedBaseUrl,
          models,
          image_models: imageModels,
          enabled,
        };
        if (apiKey.trim()) body.api_key = apiKey.trim();
        await createProvider(body);
      }
      onSaved();
    } catch (err) {
      if (err instanceof AdminApiError) {
        if (err.status === 401) {
          onUnauthorized();
          return;
        }
        if (err.status === 409) {
          setError('标识已存在，请换一个');
          setSubmitting(false);
          return;
        }
      }
      setError('保存失败，请检查输入后重试');
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-scrim" onMouseDown={onClose}>
      <form
        className="admin-modal"
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__header">
          <span className="admin-modal__title">
            {isEdit ? '编辑模型配置' : '新增模型配置'}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="admin-modal__body">
          <label className="field">
            <span className="field__label">名称</span>
            <input
              type="text"
              className="field__control"
              placeholder="如 DeepSeek"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field__label">标识</span>
            <input
              type="text"
              className="field__control"
              placeholder="deepseek"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={isEdit}
            />
            <span className="admin-field-help">
              用户侧选择时的标识，如 deepseek
              {isEdit ? '（创建后不可修改）' : ''}
            </span>
          </label>

          <label className="field">
            <span className="field__label">Base URL</span>
            <input
              type="text"
              className="field__control"
              placeholder="https://api.deepseek.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <span className="admin-field-help">
              OpenAI 兼容端点，如 https://api.deepseek.com/v1
            </span>
          </label>

          <label className="field">
            <span className="field__label">API Key</span>
            <input
              type="password"
              className="field__control"
              autoComplete="new-password"
              placeholder={isEdit ? '留空则不修改' : 'sk-...'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {isEdit && (
              <span className="admin-field-help">留空则不修改现有密钥。</span>
            )}
          </label>

          <label className="field">
            <span className="field__label">文本模型列表</span>
            <textarea
              className="field__control"
              rows={3}
              placeholder="deepseek-chat, deepseek-reasoner"
              value={modelsText}
              onChange={(e) => setModelsText(e.target.value)}
            />
            <span className="admin-field-help">
              用逗号或换行分隔多个模型。
            </span>
          </label>

          <label className="field">
            <span className="field__label">生图模型列表</span>
            <textarea
              className="field__control"
              rows={3}
              placeholder="gpt-image-1, dall-e-3"
              value={imageModelsText}
              onChange={(e) => setImageModelsText(e.target.value)}
            />
            <span className="admin-field-help">
              填在这里的模型会出现在画布的「生图扩展」里，最多一次生成 10 张。
            </span>
          </label>

          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            启用
          </label>

          {error && <div className="admin-error">{error}</div>}
        </div>

        <div className="admin-modal__footer">
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={submitting}
          >
            {submitting ? '保存中…' : isEdit ? '保存' : '创建'}
          </button>
        </div>
      </form>
    </div>
  );
}
