import { useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { listHistory, restoreHistory, type HistoryEntry } from '../api/projects';

// Human-readable label + glyph for each recorded action. The snapshot stored at
// an entry is the project state *just before* that action ran, so restoring an
// entry rolls the graph back to right before that operation.
const ACTION_META: Record<string, { label: string; icon: string }> = {
  'node.create': { label: '新建节点', icon: '＋' },
  'node.update': { label: '编辑节点', icon: '✎' },
  'node.delete': { label: '删除节点', icon: '🗑' },
  'edge.create': { label: '新建连线', icon: '↘' },
  'edge.delete': { label: '删除连线', icon: '✂' },
  'brainstorm.expand': { label: '脑爆扩展', icon: '✦' },
  'image.upload': { label: '上传图片', icon: '▧' },
  'manual.snapshot': { label: '手动存档', icon: '🔖' },
  'batch.begin': { label: '批量操作', icon: '≣' },
};

function metaFor(action: string): { label: string; icon: string } {
  return ACTION_META[action] ?? { label: '操作', icon: '•' };
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 45_000) return '刚刚';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(iso).toLocaleString();
}

interface HistoryMenuProps {
  readonly projectId: string;
  readonly onClose: () => void;
}

export function HistoryMenu({ projectId, onClose }: HistoryMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const replaceGraph = useGraphStore((s) => s.replaceGraph);
  const refreshHistoryStatus = useGraphStore((s) => s.refreshHistoryStatus);
  const pushToast = useUiStore((s) => s.pushToast);

  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listHistory(projectId)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      onClose();
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onEscape);
    };
  }, [onClose]);

  const handleRestore = async (entry: HistoryEntry) => {
    if (restoringId) return;
    setRestoringId(entry.id);
    try {
      const graph = await restoreHistory(projectId, entry.id);
      replaceGraph(graph);
      await refreshHistoryStatus(projectId);
      pushToast('success', `已回退到「${metaFor(entry.action).label}」之前`);
      onClose();
    } catch {
      pushToast('error', '回退失败');
      setRestoringId(null);
    }
  };

  return (
    <div ref={rootRef} className="history-menu" role="menu" aria-label="历史记录">
      <div className="history-menu__header">
        最近记录
        <span className="history-menu__hint">点击可回退到该操作之前</span>
      </div>

      {entries === null && <div className="history-menu__state">加载中…</div>}
      {entries !== null && entries.length === 0 && (
        <div className="history-menu__state">暂无历史记录</div>
      )}

      {entries?.map((entry, index) => {
        const meta = metaFor(entry.action);
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            className="history-menu__item"
            disabled={restoringId !== null}
            onClick={() => void handleRestore(entry)}
          >
            <span className="history-menu__icon" aria-hidden>
              {meta.icon}
            </span>
            <span className="history-menu__text">
              <span className="history-menu__label">
                {meta.label}
                {index === 0 && <span className="history-menu__tag">最近</span>}
              </span>
              <span className="history-menu__time">{relativeTime(entry.created_at)}</span>
            </span>
            {restoringId === entry.id ? (
              <span className="spinner" />
            ) : (
              <span className="history-menu__action">回退</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
