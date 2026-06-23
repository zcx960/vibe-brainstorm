import { useEffect, useState } from 'react';
import {
  adminLogin,
  listProviders,
  deleteProvider,
  getAdminToken,
  clearAdminToken,
  AdminApiError,
  type AdminProvider,
} from './adminApi';
import { ProviderForm } from './ProviderForm';
import { ProviderTable } from './ProviderTable';
import './admin.css';

/* ================================================================== *
 * Admin mini-app: password-gated 大模型配置 management.
 *
 * Fully self-contained — its own auth (admin token in sessionStorage)
 * and styling. Does NOT import the canvas / collab / user-auth stores.
 * ================================================================== */

export default function AdminApp() {
  const [authed, setAuthed] = useState<boolean>(() => !!getAdminToken());

  if (!authed) {
    return <AdminLogin onSuccess={() => setAuthed(true)} />;
  }
  return <AdminPanel onLogout={() => setAuthed(false)} />;
}

/* ------------------------------------------------------------------ *
 * Login card
 * ------------------------------------------------------------------ */
function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError('请输入密码');
      return;
    }
    setSubmitting(true);
    try {
      await adminLogin(password);
      onSuccess();
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        setError('密码错误');
      } else {
        setError('登录失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin">
      <div className="admin-login">
        <form className="admin-login__card" onSubmit={handleSubmit}>
          <div className="admin-login__brand">管理后台</div>
          <p className="admin-login__tagline">输入管理密码以继续</p>

          <label className="field">
            <span className="field__label">密码</span>
            <input
              type="password"
              className="field__control"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </label>

          {error && <div className="admin-error">{error}</div>}

          <button
            type="submit"
            className="btn btn--primary admin-login__submit"
            disabled={submitting}
          >
            {submitting ? '请稍候…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Provider management panel
 * ------------------------------------------------------------------ */
function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null = closed; 'new' = create form; AdminProvider = edit that one.
  const [editing, setEditing] = useState<AdminProvider | 'new' | null>(null);

  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listProviders();
      setProviders(list);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        // Token rejected -> back to login.
        onLogout();
        return;
      }
      setLoadError('加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = () => {
    clearAdminToken();
    onLogout();
  };

  const handleDelete = async (p: AdminProvider) => {
    if (!window.confirm(`确定删除「${p.name}」吗？此操作不可撤销。`)) return;
    try {
      await deleteProvider(p.id);
      await refresh();
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        onLogout();
        return;
      }
      window.alert('删除失败，请稍后重试');
    }
  };

  return (
    <div className="admin">
      <div className="admin-shell">
        <div className="admin-header">
          <div className="admin-header__title">大模型配置</div>
          <div className="admin-header__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleLogout}
            >
              退出
            </button>
          </div>
        </div>
        <p className="admin-note">用户在画布里选择这里配置的模型。</p>

        <div className="admin-toolbar">
          <div className="admin-toolbar__heading">模型服务商</div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setEditing('new')}
          >
            ＋ 新增模型配置
          </button>
        </div>

        <div className="admin-card">
          {loading ? (
            <div className="admin-loading">加载中…</div>
          ) : loadError ? (
            <div className="admin-empty">{loadError}</div>
          ) : providers.length === 0 ? (
            <div className="admin-empty">
              还没有配置任何模型服务商，点击「新增模型配置」开始。
            </div>
          ) : (
            <ProviderTable
              providers={providers}
              onEdit={setEditing}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>

      {editing && (
        <ProviderForm
          provider={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
          onUnauthorized={onLogout}
        />
      )}
    </div>
  );
}
