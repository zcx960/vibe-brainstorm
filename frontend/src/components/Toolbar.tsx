import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { usePresenceStore } from '../store/presenceStore';
import { createNode, patchProject } from '../api/projects';
import { ShareDialog } from './ShareDialog';
import { ThemeToggle } from './ThemeToggle';

export function Toolbar() {
  const { screenToFlowPosition, fitView } = useReactFlow();

  const projectId = useGraphStore((s) => s.projectId);
  const addNode = useGraphStore((s) => s.addNode);
  const applyLayout = useGraphStore((s) => s.applyLayout);

  const projects = useUiStore((s) => s.projects);
  const currentProjectId = useUiStore((s) => s.currentProjectId);
  const upsertProject = useUiStore((s) => s.upsertProject);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const pushToast = useUiStore((s) => s.pushToast);

  const currentUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  // Online collaborators (excludes us — presence is broadcast only from others).
  const peers = usePresenceStore((s) => s.peers);

  // Avatar roster: us first, then every online peer. Each entry is reduced to
  // the bits an avatar needs (a key, a color, and a name for the initial/title).
  const roster = [
    ...(currentUser
      ? [
          {
            key: 'self',
            color: currentUser.color,
            name: currentUser.display_name || currentUser.username,
            self: true,
          },
        ]
      : []),
    ...Object.entries(peers).map(([clientId, peer]) => ({
      key: clientId,
      color: peer.user?.color || '#6366f1',
      name: peer.user?.display_name || '协作者',
      self: false,
    })),
  ];

  const project = projects.find((p) => p.id === currentProjectId);
  const isOwner = project?.role === 'owner';

  const [nameDraft, setNameDraft] = useState(project?.name ?? '');
  const [editingName, setEditingName] = useState(false);
  const [layouting, setLayouting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingName) setNameDraft(project?.name ?? '');
  }, [project?.name, editingName]);

  useEffect(() => {
    if (editingName) nameRef.current?.select();
  }, [editingName]);

  const commitName = () => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (!project || !next || next === project.name) {
      setNameDraft(project?.name ?? '');
      return;
    }
    patchProject(project.id, { name: next })
      .then((p) => upsertProject(p))
      .catch(() => pushToast('error', '重命名失败'));
  };

  const handleNewNode = () => {
    if (!projectId) return;
    // Place near the centre of the current viewport.
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    // Small jitter so successive new nodes don't stack exactly.
    const pos = {
      x: Math.round(center.x + (Math.random() * 80 - 40)),
      y: Math.round(center.y + (Math.random() * 80 - 40)),
    };
    createNode(projectId, {
      parent_id: null,
      title: '新想法',
      content: '',
      data: { position: pos },
    })
      .then((n) => addNode(n))
      .catch(() => pushToast('error', '新建节点失败'));
  };

  const handleLayout = async () => {
    if (!projectId) return;
    setLayouting(true);
    try {
      await applyLayout();
      // Give React Flow a tick to apply positions, then fit.
      setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 50);
    } catch {
      pushToast('error', '整理布局失败');
    } finally {
      setLayouting(false);
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar__left">
        <button
          type="button"
          className="icon-btn"
          title={sidebarOpen ? '收起项目栏' : '展开项目栏'}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          ☰
        </button>
        <div className="toolbar__brand">Vibe Brainstorm</div>
        {project &&
          (editingName ? (
            <input
              ref={nameRef}
              className="toolbar__name-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') {
                  setEditingName(false);
                  setNameDraft(project.name);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="toolbar__name"
              title="点击重命名项目"
              onClick={() => setEditingName(true)}
            >
              {project.name}
            </button>
          ))}
      </div>

      <div className="toolbar__right">
        <button
          type="button"
          className="btn"
          onClick={handleNewNode}
          disabled={!projectId}
        >
          ＋ 新建节点
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleLayout}
          disabled={!projectId || layouting}
        >
          {layouting ? '整理中…' : '⤳ 整理布局'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => fitView({ padding: 0.25, duration: 400 })}
        >
          ⛶ 适配视图
        </button>

        {isOwner && project && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setShareOpen(true)}
          >
            🔗 分享
          </button>
        )}

        {roster.length > 0 && (
          <div className="presence-avatars" title="在线协作者">
            {roster.map((m) => (
              <span
                key={m.key}
                className={`presence-avatar${
                  m.self ? ' presence-avatar--self' : ''
                }`}
                style={{ background: m.color }}
                title={m.self ? `${m.name}（你）` : m.name}
              >
                {(m.name[0] ?? '?').toUpperCase()}
              </span>
            ))}
          </div>
        )}

        <ThemeToggle />

        {currentUser && (
          <div className="toolbar__user">
            <span
              className="toolbar__user-dot"
              style={{ background: currentUser.color }}
              aria-hidden
            />
            <span
              className="toolbar__user-name"
              title={currentUser.username}
            >
              {currentUser.display_name || currentUser.username}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => logout()}
              title="退出登录"
            >
              退出
            </button>
          </div>
        )}
      </div>

      {shareOpen && project && (
        <ShareDialog
          projectId={project.id}
          projectName={project.name}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
