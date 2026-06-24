import { useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { getProviders, getModes, getDefaults } from './api/config';
import {
  listProjects,
  createProject,
  createNode,
} from './api/projects';
import { acceptShare } from './api/share';
import { UNAUTHORIZED_EVENT } from './api/client';
import { useUiStore } from './store/uiStore';
import { useGraphStore } from './store/graphStore';
import { useAuthStore } from './store/authStore';
import { useCollab } from './realtime/useCollab';

import { Toolbar } from './components/Toolbar';
import { ProjectSidebar } from './components/ProjectSidebar';
import { Canvas } from './components/canvas/Canvas';
import { PresenceLayer } from './components/presence/PresenceLayer';
import { ExpandPanel } from './components/ExpandPanel';
import { ImagePanel } from './components/ImagePanel';
import { NodePreviewPanel } from './components/NodePreviewPanel';
import { Toasts } from './components/Toasts';
import { AuthGate } from './components/auth/AuthGate';

/**
 * Pull a `?join=<token>` param off the URL (if any) and strip it so a reload
 * doesn't re-trigger the accept flow. Returns the token, or null.
 */
function takeJoinToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('join');
  if (!token) return null;
  params.delete('join');
  const qs = params.toString();
  const url =
    window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  window.history.replaceState(null, '', url);
  return token;
}

export default function App() {
  const ready = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);
  const loadMe = useAuthStore((s) => s.loadMe);
  const logout = useAuthStore((s) => s.logout);

  const setConfig = useUiStore((s) => s.setConfig);
  const setProjects = useUiStore((s) => s.setProjects);
  const upsertProject = useUiStore((s) => s.upsertProject);
  const setCurrentProject = useUiStore((s) => s.setCurrentProject);
  const pushToast = useUiStore((s) => s.pushToast);
  const currentProjectId = useUiStore((s) => s.currentProjectId);

  const loadGraph = useGraphStore((s) => s.load);

  // Open the realtime collab socket for the selected project (only once signed
  // in). Passing null keeps it closed on the auth gate / before boot; the hook
  // reconnects automatically whenever the selected project changes.
  useCollab(user ? currentProjectId : null);

  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const bootedRef = useRef(false);
  const authInitRef = useRef(false);

  // Hydrate auth from the persisted token exactly once (StrictMode-safe).
  useEffect(() => {
    if (authInitRef.current) return;
    authInitRef.current = true;
    void loadMe();
  }, [loadMe]);

  // A rejected token anywhere (the API choke point / stream) broadcasts this.
  // Drop to the auth gate and reset the per-session boot guard so the canvas
  // re-boots cleanly after the next sign-in.
  useEffect(() => {
    const onUnauthorized = () => {
      logout();
      bootedRef.current = false;
      setBooting(true);
      setBootError(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [logout]);

  // Boot the canvas once we have an authenticated user.
  useEffect(() => {
    if (!ready || !user) return;
    // Guard against StrictMode double-invoke and re-runs after re-auth.
    if (bootedRef.current) return;
    bootedRef.current = true;

    void boot();

    async function boot() {
      try {
        // 1) Load config (providers / modes / defaults) in parallel.
        const [providers, modes, defaults] = await Promise.all([
          getProviders().catch(() => []),
          getModes().catch(() => []),
          getDefaults().catch(() => ({ provider: '', model: '' })),
        ]);
        setConfig({
          providers,
          modes,
          defaultProvider: defaults.provider,
          defaultModel: defaults.model,
        });

        // 2) If we arrived via a share link, accept it first so the shared
        //    project shows up in the list and can be auto-selected below.
        const joinToken = takeJoinToken();
        let joinedProjectId: string | null = null;
        if (joinToken) {
          try {
            const joined = await acceptShare(joinToken);
            joinedProjectId = joined.id;
            upsertProject(joined);
            pushToast('success', `已加入项目「${joined.name}」`);
          } catch {
            pushToast('error', '加入分享项目失败，链接可能已失效');
          }
        }

        // 3) Load project list; auto-create one only for brand-new users who
        //    also didn't just join a shared project.
        let projects = await listProjects();
        if (projects.length === 0 && !joinedProjectId) {
          const project = await createProject('我的第一个脑暴', modes[0]?.id);
          projects = [project];
          // Seed a root node.
          try {
            const root = await createNode(project.id, {
              parent_id: null,
              title: '中心主题',
              content: '双击编辑，或点击「脑爆扩展」开始发散',
              data: { position: { x: 0, y: 0 } },
            });
            void root;
          } catch {
            /* non-fatal */
          }
        }
        setProjects(projects);

        // 4) Select a project (the joined one if present) and load its graph.
        const target =
          (joinedProjectId &&
            projects.find((p) => p.id === joinedProjectId)) ||
          projects[0] ||
          null;
        if (target) {
          setCurrentProject(target.id);
          await loadGraph(target.id);
          upsertProject(target);
        }

        setBooting(false);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : '初始化失败，请检查后端是否运行';
        setBootError(msg);
        setBooting(false);
        pushToast('error', msg);
      }
    }
  }, [
    ready,
    user,
    setConfig,
    setProjects,
    upsertProject,
    setCurrentProject,
    loadGraph,
    pushToast,
  ]);

  // Wait for the auth hydration attempt before deciding what to render.
  if (!ready) {
    return <div className="app__boot">正在加载…</div>;
  }

  // Not signed in -> the login / registration gate.
  if (!user) {
    return (
      <>
        <AuthGate />
        <Toasts />
      </>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar />
        <div className="app__main">
          <ProjectSidebar />
          <div className="app__canvas">
            {booting ? (
              <div className="app__status">正在加载画布…</div>
            ) : bootError ? (
              <div className="app__status app__status--error">
                <p>无法连接后端</p>
                <p className="app__status-detail">{bootError}</p>
                <p className="app__status-detail">
                  确认后端已在 <code>http://localhost:8000</code> 运行
                  （开发模式下 Vite 会把 <code>/api</code> 代理过去）。
                </p>
              </div>
            ) : (
              <>
                <Canvas />
                {/* Remote cursors overlay — sits over the canvas, inside the
                    same positioned container, within ReactFlowProvider. */}
                <PresenceLayer />
              </>
            )}
          </div>
        </div>
        <NodePreviewPanel />
        <ExpandPanel />
        <ImagePanel />
        <Toasts />
      </div>
    </ReactFlowProvider>
  );
}
