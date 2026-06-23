import { useCallback } from 'react';
import { streamImageGenerate } from '../../api/images';
import { createEdge } from '../../api/projects';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import type { ImageGenerateRequest, NodeT } from '../../types';

/**
 * Wraps streamImageGenerate for the UI:
 *   - marks the source node as "generating" (spinner)
 *   - on each `image` event, inserts the (already-persisted) image child node
 *     and a parent->child edge into the canvas immediately (progressive reveal)
 *   - on `image_error`, toasts the per-image message but continues
 *   - on `done`, toasts the count and runs an elkjs layout pass to tidy the new
 *     images
 *   - on `error`, toasts the fatal message and clears the busy state
 *
 * Mirrors useExpand's edge handling: synthesize a visible local edge per image
 * and best-effort persist a real parent->child edge (ignoring conflicts).
 */
export function useImageGen() {
  const addNode = useGraphStore((s) => s.addNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const applyLayout = useGraphStore((s) => s.applyLayout);

  const startGenerating = useUiStore((s) => s.startGenerating);
  const stopGenerating = useUiStore((s) => s.stopGenerating);
  const pushToast = useUiStore((s) => s.pushToast);

  const generate = useCallback(
    (req: ImageGenerateRequest) => {
      const sourceId = req.node_id;
      startGenerating(sourceId);
      let received = 0;

      const ensureEdge = async (child: NodeT, edgeId?: string) => {
        addEdge({
          id: edgeId ?? `local-${sourceId}-${child.id}`,
          project_id: req.project_id,
          source_id: sourceId,
          target_id: child.id,
          data: {},
        });
        if (edgeId) return;
        try {
          await createEdge(req.project_id, {
            source_id: sourceId,
            target_id: child.id,
          });
        } catch {
        }
      };

      const { abort } = streamImageGenerate(req, {
        onImage: (e) => {
          received += 1;
          addNode(e.node);
          void ensureEdge(e.node, e.edge?.id);
        },
        onImageError: (e) => {
          pushToast('error', e.message || `第 ${e.index + 1} 张图片生成失败`);
        },
        onDone: (e) => {
          stopGenerating(sourceId);
          const n = e.count_ok ?? e.node_ids?.length ?? received;
          pushToast('success', `生成 ${n} 张图片`);
          void applyLayout();
        },
        onError: (e) => {
          stopGenerating(sourceId);
          pushToast('error', e.message || '生图失败');
        },
      });

      return abort;
    },
    [addNode, addEdge, applyLayout, startGenerating, stopGenerating, pushToast],
  );

  return { generate };
}
