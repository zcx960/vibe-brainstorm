import { useCallback } from 'react';
import { streamExpand } from '../../api/brainstorm';
import { createEdge } from '../../api/projects';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import type { ExpandRequest, NodeT } from '../../types';

/**
 * Wraps streamExpand for the UI:
 *   - marks the source node as "expanding" (spinner)
 *   - on each `idea` event, inserts the (already-persisted) child node and a
 *     parent->child edge into the canvas immediately (progressive reveal)
 *   - on `done`, runs an elkjs layout pass to tidy the new children, and toasts
 *   - on `error`, toasts the message
 *
 * Edge handling: the backend returns `edge_ids` in the `done` event but does
 * not stream edge objects per idea. To keep the canvas connected during the
 * stream we synthesize a local edge per child so the parent->child link is
 * visible right away. If the backend also created edges (edge_ids non-empty),
 * the next graph reload reconciles them; the synthesized ids are deterministic
 * so they don't duplicate visually within the session.
 */
export function useExpand() {
  const addNode = useGraphStore((s) => s.addNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const applyLayout = useGraphStore((s) => s.applyLayout);

  const startExpanding = useUiStore((s) => s.startExpanding);
  const stopExpanding = useUiStore((s) => s.stopExpanding);
  const pushToast = useUiStore((s) => s.pushToast);

  const expand = useCallback(
    (req: ExpandRequest) => {
      const sourceId = req.node_id;
      startExpanding(sourceId);
      let received = 0;

      const ensureEdge = async (child: NodeT) => {
        // Add a visible edge immediately using a synthetic id.
        const synthId = `local-${sourceId}-${child.id}`;
        addEdge({
          id: synthId,
          project_id: req.project_id,
          source_id: sourceId,
          target_id: child.id,
          data: {},
        });
        // Best-effort: also persist a real edge if the backend didn't already.
        try {
          await createEdge(req.project_id, {
            source_id: sourceId,
            target_id: child.id,
          });
        } catch {
          /* backend may already have created it; ignore conflicts */
        }
      };

      const { abort } = streamExpand(req, {
        onIdea: (e) => {
          received += 1;
          addNode(e.node);
          void ensureEdge(e.node);
        },
        onDone: (e) => {
          stopExpanding(sourceId);
          const n = e.node_ids?.length ?? received;
          pushToast('success', `脑爆完成，新增 ${n} 个想法`);
          // Tidy the freshly inserted children.
          void applyLayout();
        },
        onError: (e) => {
          stopExpanding(sourceId);
          pushToast('error', e.message || '脑爆失败');
        },
      });

      return abort;
    },
    [addNode, addEdge, applyLayout, startExpanding, stopExpanding, pushToast],
  );

  return { expand };
}
