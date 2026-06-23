import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import type { IdeaRFNode } from '../../store/graphStore';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import {
  usePresenceStore,
  remoteSelectionColor,
} from '../../store/presenceStore';
import { patchNode } from '../../api/projects';

function IdeaNodeImpl({ id, data, selected }: NodeProps<IdeaRFNode>) {
  const projectId = useGraphStore((s) => s.projectId);
  const updateNodeContent = useGraphStore((s) => s.updateNodeContent);
  const { deleteElements } = useReactFlow();

  const openExpandPanel = useUiStore((s) => s.openExpandPanel);
  const expanding = useUiStore((s) => s.expandingNodeIds.has(id));
  const openImagePanel = useUiStore((s) => s.openImagePanel);
  const generating = useUiStore((s) => s.generatingNodeIds.has(id));
  const busy = expanding || generating;

  // Color of a remote collaborator who currently has this node selected (if
  // any). Drives an additive outline so you can see what others are looking at.
  const peerColor = usePresenceStore(remoteSelectionColor(id));

  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.title);
  const [contentDraft, setContentDraft] = useState(data.content);
  const titleRef = useRef<HTMLInputElement>(null);

  // Keep drafts in sync if the node changes underneath us (e.g. layout/reload).
  useEffect(() => {
    if (!editing) {
      setTitleDraft(data.title);
      setContentDraft(data.content);
    }
  }, [data.title, data.content, editing]);

  useEffect(() => {
    if (editing) titleRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const nextTitle = titleDraft.trim() || '未命名';
    const titleChanged = nextTitle !== data.title;
    const contentChanged = contentDraft !== data.content;
    if (!titleChanged && !contentChanged) return;

    updateNodeContent(id, { title: nextTitle, content: contentDraft });
    if (projectId) {
      patchNode(projectId, id, {
        ...(titleChanged ? { title: nextTitle } : {}),
        ...(contentChanged ? { content: contentDraft } : {}),
      }).catch(() => {
        useUiStore.getState().pushToast('error', '保存节点失败');
      });
    }
  };

  const accent = data.color || '#6366f1';

  return (
    <div
      className={`idea-node${selected ? ' idea-node--selected' : ''}${
        busy ? ' idea-node--busy' : ''
      }${expanding ? ' idea-node--expanding' : ''}${
        generating ? ' idea-node--generating' : ''
      }${peerColor ? ' idea-node--peer-selected' : ''}`}
      aria-busy={busy}
      style={{
        borderTopColor: accent,
        position: 'relative',
        // Additive ring in the peer's color when a collaborator has this node
        // selected. Set as a CSS var so index.css can compose the box-shadow.
        ...(peerColor
          ? ({ '--peer-color': peerColor } as CSSProperties)
          : {}),
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing) setEditing(true);
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
            void deleteElements({ nodes: [{ id }] });
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

      {editing ? (
        <div className="idea-node__edit nodrag">
          <input
            ref={titleRef}
            className="idea-node__title-input"
            value={titleDraft}
            placeholder="标题"
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setEditing(false);
                setTitleDraft(data.title);
                setContentDraft(data.content);
              }
            }}
          />
          <textarea
            className="idea-node__content-input"
            value={contentDraft}
            placeholder="补充说明…"
            rows={3}
            onChange={(e) => setContentDraft(e.target.value)}
            onBlur={commit}
          />
        </div>
      ) : (
        <div className="idea-node__body">
          <div className="idea-node__title">{data.title || '未命名'}</div>
          {data.content && (
            <div className="idea-node__content">{data.content}</div>
          )}
        </div>
      )}

      <div className="idea-node__footer">
        <button
          type="button"
          className="idea-node__action-btn idea-node__image-btn nodrag"
          disabled={generating}
          onClick={(e) => {
            e.stopPropagation();
            openImagePanel(
              id,
              [data.title, data.content].filter(Boolean).join('\n'),
            );
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
        <button
          type="button"
          className="idea-node__action-btn idea-node__expand-btn nodrag"
          disabled={expanding}
          onClick={(e) => {
            e.stopPropagation();
            openExpandPanel(id);
          }}
        >
          {expanding ? (
            <>
              <span className="spinner" /> 脑爆中…
            </>
          ) : (
            <>脑爆扩展</>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Bottom} className="idea-handle" />
    </div>
  );
}

export const IdeaNode = memo(IdeaNodeImpl);
