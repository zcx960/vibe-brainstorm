import { memo, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { IdeaRFNode } from '../../store/graphStore';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import {
  usePresenceStore,
  remoteSelectionColor,
} from '../../store/presenceStore';

function GalleryNodeImpl({ id, data, selected }: NodeProps<IdeaRFNode>) {
  const projectId = useGraphStore((s) => s.projectId);
  const openDeleteConfirm = useUiStore((s) => s.openDeleteConfirm);
  const peerColor = usePresenceStore(remoteSelectionColor(id));

  const accent = data.color || '#0ea5e9';
  const images = data.images ?? [];
  const thumbs = images.slice(0, 4);

  const openGallery = () => {
    if (!projectId) return;
    window.open(
      `/gallery/${encodeURIComponent(projectId)}/${encodeURIComponent(id)}`,
      '_blank',
      'noopener',
    );
  };

  return (
    <div
      className={`gallery-node${selected ? ' gallery-node--selected' : ''}${
        peerColor ? ' gallery-node--peer-selected' : ''
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
        openGallery();
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
            openDeleteConfirm(id, data.title || '未命名图库');
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

      <div className="gallery-node__body">
        <div className="gallery-node__title">
          <span className="gallery-node__icon" aria-hidden>
            🖼
          </span>
          {data.title || '未命名图库'}
          <span className="gallery-node__count">{images.length}</span>
        </div>

        {thumbs.length > 0 ? (
          <div className="gallery-node__grid">
            {thumbs.map((img) => (
              <div key={img.id} className="gallery-node__thumb">
                <img src={img.url} alt={img.caption || ''} draggable={false} />
              </div>
            ))}
          </div>
        ) : (
          <div className="gallery-node__empty">空图库</div>
        )}
      </div>

      <div className="gallery-node__footer">
        <button
          type="button"
          className="idea-node__action-btn gallery-node__open-btn nodrag"
          onClick={(e) => {
            e.stopPropagation();
            openGallery();
          }}
        >
          打开图库
        </button>
      </div>

      <Handle type="source" position={Position.Bottom} className="idea-handle" />
    </div>
  );
}

export const GalleryNode = memo(GalleryNodeImpl);
