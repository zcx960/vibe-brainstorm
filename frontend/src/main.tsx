import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import AdminApp from './admin/AdminApp.tsx';
import DocEditorPage from './pages/DocEditorPage.tsx';
import GalleryPage from './pages/GalleryPage.tsx';
import { applyTheme, getStoredPref, initSystemThemeListener } from './theme';
import './index.css';

// Keep the resolved theme in sync at runtime (the no-flash bootstrap in
// index.html already set the initial data-theme before first paint).
applyTheme(getStoredPref());
initSystemThemeListener();

// Route by pathname:
//   /admin            -> the self-contained admin mini-app
//   /doc/{pid}/{nid}  -> the standalone collaborative document editor (new tab)
//   everything else   -> the main canvas app
// AdminApp / DocEditorPage bring their own shells and must not pull in the
// canvas <ReactFlowProvider>, so we keep that inside <App /> only.
const rawPath = window.location.pathname;
const path = rawPath.replace(/\/+$/, '');
const isAdmin = path === '/admin' || path.endsWith('/admin');
const isDoc = rawPath.startsWith('/doc/');
const isGallery = rawPath.startsWith('/gallery/');

const root = isAdmin ? (
  <AdminApp />
) : isDoc ? (
  <DocEditorPage />
) : isGallery ? (
  <GalleryPage />
) : (
  <App />
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>{root}</StrictMode>,
);
