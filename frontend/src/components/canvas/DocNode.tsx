import { memo, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { IdeaRFNode } from '../../store/graphStore';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import {
  usePresenceStore,
  remoteSelectionColor,
} from '../../store/presenceStore';

// Strip HTML tags so the card preview shows plain text, not raw markup.
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function DocNodeImpl({ id, data, selected }: NodeProps<IdeaRFNode>) {
  const projectId = useGraphStore((s) => s.projectId);
  const openDeleteConfirm = useUiStore((s) => s.openDeleteConfirm);
  const peerColor = usePresenceStore(remoteSelectionColor(id));

  const accent = data.color || '#8b5cf6';
  const preview = plainText(data.content || '');

  const openDoc = () => {
    if (!projectId) return;
    window.open(
      `/doc/${encodeURIComponent(projectId)}/${encodeURIComponent(id)}`,
      '_blank',
      'noopener',
    );
  };

  return (
    <div
      className={`doc-node${selected ? ' doc-node--selected' : ''}${
        peerColor ? ' doc-node--peer-selected' : ''
      }`}
      style={{
        borderTopColor: accent,
        position: 'relative',
        ...(peerColor
          ? ({ '--peer-color': peerColor } as CSSProperties)
          : {}),
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        openDoc();
      }}
    >
      {selected && (
        <button
          type="button"
          className="nodrag"
          title="删除节点"
          aria-label="删除节点"
          onClick={(e) => {
            e.stopPropagation();
            openDeleteConfirm(id, data.title || '未命名文档');
          }}
          style={{
            position: 'absolute',
            zIndex: 1,
            top: -10,
            right: -10,
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: '1px solid #e5e7eb',
            background: '#fff',
            color: '#ef4444',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: '20px',
            padding: 0,
            boxShadow: '0 1px 3px rgba(0,0,0,.15)',
          }}
        >
          ×
        </button>
      )}

      <Handle type="target" position={Position.Top} className="idea-handle" />

      <div className="doc-node__body">
        <div className="doc-node__title">
          <span className="doc-node__icon" aria-hidden>
            📄
          </span>
          {data.title || '未命名文档'}
        </div>
        <div className="doc-node__preview">
          {preview ? preview.slice(0, 120) : '空文档'}
        </div>
      </div>

      <div className="doc-node__footer">
        <button
          type="button"
          className="idea-node__action-btn doc-node__open-btn nodrag"
          onClick={(e) => {
            e.stopPropagation();
            openDoc();
          }}
        >
          打开文档
        </button>
      </div>

      <Handle type="source" position={Position.Bottom} className="idea-handle" />
    </div>
  );
}

export const DocNode = memo(DocNodeImpl);
