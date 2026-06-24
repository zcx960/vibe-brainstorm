import { memo, useState, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { IdeaRFNode } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import {
  usePresenceStore,
  remoteSelectionColor,
} from '../../store/presenceStore';

/**
 * Canvas node that renders a generated image (kind === 'image'). Created as a
 * normal persisted child node by the /api/images/generate stream, so it flows
 * through addNode / upsertNodeFromRemote / delete / layout exactly like an idea
 * node. It can also be used as the source for another image generation pass.
 */
function ImageNodeImpl({ id, data, selected }: NodeProps<IdeaRFNode>) {
  const openImagePanel = useUiStore((s) => s.openImagePanel);
  const generating = useUiStore((s) => s.generatingNodeIds.has(id));
  const peerColor = usePresenceStore(remoteSelectionColor(id));
  const openDeleteConfirm = useUiStore((s) => s.openDeleteConfirm);
  const [broken, setBroken] = useState(false);

  const caption = data.prompt || data.title || '';
  const defaultPrompt = [caption, data.content]
    .filter((part): part is string => Boolean(part))
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join('\n');

  return (
    <div
      className={`image-node${selected ? ' image-node--selected' : ''}${
        generating ? ' image-node--busy image-node--generating' : ''
      }${
        peerColor ? ' image-node--peer-selected' : ''
      }`}
      aria-busy={generating}
      style={{
        position: 'relative',
        ...(peerColor ? ({ '--peer-color': peerColor } as CSSProperties) : {}),
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
            openDeleteConfirm(id, data.title || '未命名节点');
          }}
          style={{
            position: 'absolute',
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
            zIndex: 1,
          }}
        >
          ×
        </button>
      )}

      <Handle type="target" position={Position.Top} className="idea-handle" />

      <div className="image-node__frame">
        {broken || !data.imageUrl ? (
          <div className="image-node__broken">图片加载失败</div>
        ) : (
          <img
            className="image-node__img"
            src={data.imageUrl}
            alt={caption || '生成的图片'}
            draggable={false}
            onError={() => setBroken(true)}
          />
        )}
      </div>

      {caption && <div className="image-node__caption">{caption}</div>}

      <div className="image-node__footer">
        <button
          type="button"
          className="idea-node__action-btn idea-node__image-btn nodrag"
          disabled={generating}
          onClick={(e) => {
            e.stopPropagation();
            openImagePanel(id, defaultPrompt);
          }}
        >
          {generating ? (
            <>
              <span className="spinner" /> 生图中…
            </>
          ) : (
            <>生图扩展</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Bottom} className="idea-handle" />
    </div>
  );
}

export const ImageNode = memo(ImageNodeImpl);
