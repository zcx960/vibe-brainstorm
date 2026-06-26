import { useMemo } from 'react';
import { Panel, useReactFlow } from '@xyflow/react';
import {
  useGraphStore,
  DEFAULT_REGION_WIDTH,
  DEFAULT_REGION_HEIGHT,
  type IdeaRFNode,
} from '../../store/graphStore';

function regionBounds(node: IdeaRFNode) {
  const width = node.width ?? node.data.width ?? DEFAULT_REGION_WIDTH;
  const height = node.height ?? node.data.height ?? DEFAULT_REGION_HEIGHT;
  return { x: node.position.x, y: node.position.y, width, height };
}

export function RegionList() {
  const { fitBounds } = useReactFlow();
  // Select the stable rfNodes reference and derive regions with useMemo. Filtering
  // inside the selector would return a fresh array each call and send Zustand v5
  // (useSyncExternalStore) into an infinite render loop.
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const regions = useMemo(
    () => rfNodes.filter((n) => n.type === 'region'),
    [rfNodes],
  );

  if (regions.length === 0) return null;

  return (
    <Panel position="top-left" className="region-list">
      <div className="region-list__header">区域 ({regions.length})</div>
      <div className="region-list__items">
        {regions.map((node) => {
          const accent = node.data.color || '#64748b';
          return (
            <button
              key={node.id}
              type="button"
              className="region-list__item"
              title={`跳转到「${node.data.title || '未命名区域'}」`}
              onClick={() =>
                void fitBounds(regionBounds(node), { padding: 0.2, duration: 400 })
              }
            >
              <span
                className="region-list__dot"
                style={{ background: accent }}
                aria-hidden
              />
              <span className="region-list__name">
                {node.data.title || '未命名区域'}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
