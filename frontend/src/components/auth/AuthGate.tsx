import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { ApiError } from '../../api/client';

type Tab = 'login' | 'register';

export function AuthGate() {
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setError(null);
  };

  const messageFor = (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.status === 409) return '用户名已被注册';
      if (err.status === 401) return '用户名或密码错误';
      if (err.status === 400 || err.status === 422) return '请检查输入是否正确';
    }
    return '出错了，请稍后重试';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      setError('请填写用户名和密码');
      return;
    }

    setSubmitting(true);
    try {
      if (tab === 'login') {
        await login(trimmedUsername, password);
      } else {
        await register(
          trimmedUsername,
          password,
          displayName.trim() || undefined,
        );
      }
      // On success the auth store flips `user`; App swaps to the canvas.
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={handleSubmit}>
        <div className="auth__brand">Vibe Brainstorm</div>
        <p className="auth__tagline">登录后继续你的灵感发散</p>

        <div className="auth__tabs">
          <button
            type="button"
            className={`auth__tab${tab === 'login' ? ' auth__tab--active' : ''}`}
            onClick={() => switchTab('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={`auth__tab${
              tab === 'register' ? ' auth__tab--active' : ''
            }`}
            onClick={() => switchTab('register')}
          >
            注册
          </button>
        </div>

        <div className="auth__fields">
          <label className="field">
            <span className="field__label">用户名</span>
            <input
              type="text"
              className="field__control"
              autoComplete="username"
              placeholder="起一个用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">密码</span>
            <input
              type="password"
              className="field__control"
              autoComplete={
                tab === 'login' ? 'current-password' : 'new-password'
              }
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {tab === 'register' && (
            <label className="field">
              <span className="field__label">显示名称（可选）</span>
              <input
                type="text"
                className="field__control"
                autoComplete="nickname"
                placeholder="怎么称呼你"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
          )}
        </div>

        {error && <div className="auth__error">{error}</div>}

        <button
          type="submit"
          className="btn btn--primary auth__submit"
          disabled={submitting}
        >
          {submitting
            ? '请稍候…'
            : tab === 'login'
              ? '登录'
              : '注册并开始'}
        </button>
      </form>
    </div>
  );
}
