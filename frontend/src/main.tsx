import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import AdminApp from './admin/AdminApp.tsx';
import { applyTheme, getStoredPref, initSystemThemeListener } from './theme';
import './index.css';

// Keep the resolved theme in sync at runtime (the no-flash bootstrap in
// index.html already set the initial data-theme before first paint).
applyTheme(getStoredPref());
initSystemThemeListener();

// Route by pathname: anything under `/admin` (with optional trailing slashes)
// renders the self-contained admin mini-app instead of the main canvas app.
// AdminApp brings its own auth + styling and must not pull in the canvas /
// collab stores, so we keep <ReactFlowProvider> etc. inside <App /> only.
const path = window.location.pathname.replace(/\/+$/, '');
const isAdmin = path === '/admin' || path.endsWith('/admin');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAdmin ? <AdminApp /> : <App />}</StrictMode>,
);
