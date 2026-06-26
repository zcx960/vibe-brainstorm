import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import type { IdeaRFNode } from '../../store/graphStore';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { patchNode } from '../../api/projects';

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(100, 116, 139, ${alpha})`;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Preset accent palette for distinguishing functional regions.
const REGION_COLORS = [
  '#64748b',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#06b6d4',
];

function RegionNodeImpl({ id, data, selected }: NodeProps<IdeaRFNode>) {
  const projectId = useGraphStore((s) => s.projectId);
  const saveRegionBox = useGraphStore((s) => s.saveRegionBox);
  const setRegionColor = useGraphStore((s) => s.setRegionColor);
  const updateNodeContent = useGraphStore((s) => s.updateNodeContent);
  const openDeleteConfirm = useUiStore((s) => s.openDeleteConfirm);

  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.title);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setTitleDraft(data.title);
  }, [data.title, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const accent = data.color || '#64748b';

  const commitTitle = () => {
    setEditing(false);
    const next = titleDraft.trim() || '未命名区域';
    if (next === data.title) return;
    updateNodeContent(id, { title: next });
    if (projectId) {
      patchNode(projectId, id, { title: next }).catch(() =>
        useUiStore.getState().pushToast('error', '重命名区域失败'),
      );
    }
  };

  return (
    <div
      className={`region-node${selected ? ' region-node--selected' : ''}`}
      style={
        {
          width: '100%',
          height: '100%',
          '--region-accent': accent,
          background: hexToRgba(accent, 0.08),
          borderColor: hexToRgba(accent, 0.55),
        } as CSSProperties
      }
    >
      <NodeResizer
        // No `color` prop: it would inline a backgroundColor onto the handles.
        // Corners stay grabbable on hover (resize cursor) but render nothing;
        // edge lines are disabled so dragging the perimeter still pans.
        minWidth={180}
        minHeight={120}
        handleClassName="region-resize-handle"
        lineClassName="region-resize-line"
        handleStyle={{
          width: 16,
          height: 16,
          background: 'transparent',
          border: 'none',
        }}
        lineStyle={{ border: 'none', opacity: 0, pointerEvents: 'none' }}
        onResizeEnd={(_evt, p) =>
          saveRegionBox(id, {
            x: p.x,
            y: p.y,
            width: p.width,
            height: p.height,
          })
        }
      />

      <div className="region-node__tab" style={{ background: hexToRgba(accent, 0.92) }}>
        {editing ? (
          <input
            ref={inputRef}
            className="region-node__title-input nodrag"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') {
                setEditing(false);
                setTitleDraft(data.title);
              }
            }}
          />
        ) : (
          <span
            className="region-node__title"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            title="双击重命名"
          >
            ▭ {data.title || '未命名区域'}
          </span>
        )}

        {selected && (
          <button
            type="button"
            className="region-node__color nodrag"
            title="区域颜色"
            aria-label="区域颜色"
            style={{ background: '#fff', borderColor: accent }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setPaletteOpen((v) => !v);
            }}
          >
            <span
              className="region-node__color-dot"
              style={{ background: accent }}
            />
          </button>
        )}

        {selected && (
          <button
            type="button"
            className="region-node__del nodrag"
            title="删除区域"
            aria-label="删除区域"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              openDeleteConfirm(id, data.title || '未命名区域');
            }}
          >
            ×
          </button>
        )}

        {selected && paletteOpen && (
          <div
            className="region-node__palette nodrag"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {REGION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`region-node__swatch${
                  c === accent ? ' region-node__swatch--active' : ''
                }`}
                style={{ background: c }}
                title={c}
                aria-label={`设为 ${c}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setRegionColor(id, c);
                  setPaletteOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const RegionNode = memo(RegionNodeImpl);
