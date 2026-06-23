import { useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { useGraphStore } from '../store/graphStore';
import {
  createProject,
  deleteProject as apiDeleteProject,
} from '../api/projects';

export function ProjectSidebar() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const projects = useUiStore((s) => s.projects);
  const currentProjectId = useUiStore((s) => s.currentProjectId);
  const upsertProject = useUiStore((s) => s.upsertProject);
  const removeProject = useUiStore((s) => s.removeProject);
  const setCurrentProject = useUiStore((s) => s.setCurrentProject);
  const defaultMode = useUiStore((s) => s.modes[0]?.id);
  const pushToast = useUiStore((s) => s.pushToast);

  const loadGraph = useGraphStore((s) => s.load);
  const clearGraph = useGraphStore((s) => s.clear);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const selectProject = async (id: string) => {
    if (id === currentProjectId) return;
    setCurrentProject(id);
    try {
      await loadGraph(id);
    } catch {
      pushToast('error', '加载项目失败');
    }
  };

  const handleCreate = async () => {
    const name = newName.trim() || '未命名脑暴';
    try {
      const project = await createProject(name, defaultMode);
      upsertProject(project);
      setNewName('');
      setCreating(false);
      await selectProject(project.id);
    } catch {
      pushToast('error', '创建项目失败');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`删除项目「${name}」？此操作不可撤销。`)) return;
    try {
      await apiDeleteProject(id);
      const wasCurrent = id === currentProjectId;
      removeProject(id);
      if (wasCurrent) {
        const remaining = projects.filter((p) => p.id !== id);
        if (remaining.length > 0) {
          await selectProject(remaining[0].id);
        } else {
          clearGraph();
        }
      }
    } catch {
      pushToast('error', '删除项目失败');
    }
  };

  if (!sidebarOpen) return null;

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <span className="sidebar__title">项目</span>
        <button
          type="button"
          className="icon-btn"
          title="新建项目"
          onClick={() => setCreating((v) => !v)}
        >
          ＋
        </button>
      </div>

      {creating && (
        <div className="sidebar__create">
          <input
            autoFocus
            className="field__control"
            placeholder="项目名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
              if (e.key === 'Escape') {
                setCreating(false);
                setNewName('');
              }
            }}
          />
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={handleCreate}
          >
            创建
          </button>
        </div>
      )}

      <ul className="sidebar__list">
        {projects.length === 0 && (
          <li className="sidebar__empty">还没有项目</li>
        )}
        {projects.map((p) => (
          <li
            key={p.id}
            className={`sidebar__item${
              p.id === currentProjectId ? ' sidebar__item--active' : ''
            }`}
          >
            <button
              type="button"
              className="sidebar__item-name"
              onClick={() => selectProject(p.id)}
              title={p.name}
            >
              {p.name}
            </button>
            <button
              type="button"
              className="sidebar__item-del"
              title="删除项目"
              onClick={() => handleDelete(p.id, p.name)}
            >
              🗑
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
