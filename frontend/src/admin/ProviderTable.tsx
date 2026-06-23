import type { AdminProvider } from './adminApi';

interface ProviderTableProps {
  providers: AdminProvider[];
  onEdit: (provider: AdminProvider) => void;
  onDelete: (provider: AdminProvider) => void;
}

export function ProviderTable({
  providers,
  onEdit,
  onDelete,
}: ProviderTableProps) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>名称</th>
          <th>标识</th>
          <th>Base URL</th>
          <th>文本模型</th>
          <th>生图模型</th>
          <th>状态</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {providers.map((provider) => (
          <tr key={provider.id}>
            <td className="admin-table__name">{provider.name}</td>
            <td>
              <span className="admin-key">{provider.key}</span>
            </td>
            <td>
              <span className="admin-url">{provider.base_url}</span>
            </td>
            <td>
              <ModelChips models={provider.models} />
            </td>
            <td>
              <ModelChips models={provider.image_models} image />
            </td>
            <td>
              <div className="admin-status">
                <span
                  className={`admin-badge ${
                    provider.enabled ? 'admin-badge--on' : 'admin-badge--off'
                  }`}
                >
                  {provider.enabled ? '已启用' : '已停用'}
                </span>
                <span
                  className={`admin-badge ${
                    provider.has_key ? 'admin-badge--key' : 'admin-badge--nokey'
                  }`}
                >
                  {provider.has_key ? '已配置密钥' : '缺少密钥'}
                </span>
              </div>
            </td>
            <td>
              <div className="admin-row-actions">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => onEdit(provider)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => onDelete(provider)}
                >
                  删除
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModelChips({
  models,
  image = false,
}: {
  models: string[];
  image?: boolean;
}) {
  if (models.length === 0) {
    return <span className="admin-field-help">—</span>;
  }
  return (
    <div className="admin-models">
      {models.map((model) => (
        <span
          key={model}
          className={`admin-model-chip${
            image ? ' admin-model-chip--image' : ''
          }`}
        >
          {model}
        </span>
      ))}
    </div>
  );
}
