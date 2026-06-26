import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import type { NodeT, EdgeT, GraphResponse, GalleryImage } from '../types';
import {
  beginHistoryBatch,
  getGraph,
  getHistoryStatus,
  patchNode,
} from '../api/projects';
import {
  layoutGraph,
  NODE_WIDTH,
  NODE_HEIGHT,
  type LayoutNodeInput,
} from '../lib/layout';

// The data we hang on each React Flow node (consumed by IdeaNode / ImageNode).
export interface RFNodeData extends Record<string, unknown> {
  nodeId: string;
  title: string;
  content: string;
  color?: string;
  parentId: string | null;
  // Image nodes carry these (kind === 'image').
  kind?: 'idea' | 'image' | 'document' | 'region' | 'gallery';
  imageUrl?: string;
  prompt?: string;
  referenceImageUrls?: string[];
  // Region nodes (kind === 'region') carry their backboard box size.
  width?: number;
  height?: number;
  // Gallery nodes (kind === 'gallery') carry their image list.
  images?: GalleryImage[];
}

// Idea, image, document, region and gallery nodes share the same data shape;
// only the RF `type` differs so React Flow renders the right component. Keep one
// node type alias so existing store code (load, upsert, layout, changes) flows
// unchanged.
export type IdeaRFNode = RFNode<
  RFNodeData,
  'idea' | 'image' | 'document' | 'region' | 'gallery'
>;

// Default backboard size for a freshly created region.
export const DEFAULT_REGION_WIDTH = 420;
export const DEFAULT_REGION_HEIGHT = 300;

// ---- conversions between domain types and React Flow types ----

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length > 0 ? strings : undefined;
}

export function toRFNode(n: NodeT): IdeaRFNode {
  const kind =
    n.data?.kind === 'image'
      ? 'image'
      : n.data?.kind === 'document'
        ? 'document'
        : n.data?.kind === 'region'
          ? 'region'
          : n.data?.kind === 'gallery'
            ? 'gallery'
            : 'idea';

  const base: IdeaRFNode = {
    id: n.id,
    type: kind,
    position: { x: n.data?.position?.x ?? 0, y: n.data?.position?.y ?? 0 },
    data: {
      nodeId: n.id,
      title: n.title,
      content: n.content,
      color: n.data?.color,
      parentId: n.parent_id,
      kind,
      imageUrl: n.data?.image_url,
      prompt: n.data?.prompt,
      referenceImageUrls: stringArray(n.data?.reference_image_urls),
      images: Array.isArray(n.data?.images) ? n.data.images : undefined,
    },
  };

  if (kind === 'region') {
    const width =
      typeof n.data?.width === 'number' ? n.data.width : DEFAULT_REGION_WIDTH;
    const height =
      typeof n.data?.height === 'number' ? n.data.height : DEFAULT_REGION_HEIGHT;
    return {
      ...base,
      width,
      height,
      // Render the backboard beneath all other nodes so nodes placed on top
      // stay interactive.
      zIndex: -1,
      // Only the title tab drags the region; its body is click-through so
      // dragging the empty area pans the canvas. React Flow sets the node
      // wrapper to `pointer-events: all`, but spreads `node.style` after it —
      // so this overrides the wrapper to be click-through. The tab + resize
      // handles re-enable pointer-events in CSS.
      dragHandle: '.region-node__tab',
      style: { pointerEvents: 'none' },
      data: { ...base.data, width, height },
    };
  }

  return base;
}

export function toRFEdge(e: EdgeT): RFEdge {
  return {
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: 'default',
    animated: false,
  };
}

interface GraphState {
  projectId: string | null;
  rfNodes: IdeaRFNode[];
  rfEdges: RFEdge[];
  loading: boolean;
  historyCount: number;

  load: (projectId: string) => Promise<void>;
  clear: () => void;
  replaceGraph: (graph: GraphResponse) => void;
  refreshHistoryStatus: (projectId?: string) => Promise<void>;

  // React Flow change handlers.
  onNodesChange: (changes: NodeChange<IdeaRFNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;

  // Imperative mutations (used by expansion / toolbar).
  addNode: (n: NodeT) => void;
  // Idempotent upsert from a remote collaborator's frame: update an existing
  // node's title/content/position/color/parent in place, or add it if new.
  upsertNodeFromRemote: (n: NodeT) => void;
  addEdge: (e: EdgeT) => void;
  updateNodeContent: (
    nodeId: string,
    patch: { title?: string; content?: string },
  ) => void;
  removeNode: (nodeId: string) => void;
  removeEdge: (edgeId: string) => void;

  // Persist a single node's position (debounced per node).
  scheduleSavePosition: (nodeId: string) => void;

  // Persist a region node's box (position + size) after a resize/move.
  saveRegionBox: (
    nodeId: string,
    box: { x: number; y: number; width: number; height: number },
  ) => void;

  // Update a region's accent color (local + persisted, broadcast as node.updated).
  setRegionColor: (nodeId: string, color: string) => void;

  // Re-layout the whole graph with elkjs and persist new positions.
  applyLayout: () => Promise<void>;
}

// Per-node debounce timers for position autosave.
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const SAVE_DEBOUNCE_MS = 600;

export const useGraphStore = create<GraphState>((set, get) => ({
  projectId: null,
  rfNodes: [],
  rfEdges: [],
  loading: false,
  historyCount: 0,

  load: async (projectId) => {
    set({ loading: true, projectId });
    try {
      const graph: GraphResponse = await getGraph(projectId);
      set({
        rfNodes: graph.nodes.map(toRFNode),
        rfEdges: graph.edges.map(toRFEdge),
        loading: false,
      });
      await get().refreshHistoryStatus(projectId);
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  clear: () =>
    set({
      rfNodes: [],
      rfEdges: [],
      projectId: null,
      historyCount: 0,
    }),

  replaceGraph: (graph) =>
    set({
      rfNodes: graph.nodes.map(toRFNode),
      rfEdges: graph.edges.map(toRFEdge),
      loading: false,
    }),

  refreshHistoryStatus: async (projectId) => {
    const pid = projectId ?? get().projectId;
    if (!pid) return;
    try {
      const status = await getHistoryStatus(pid);
      set({ historyCount: status.count });
    } catch {
      /* best-effort */
    }
  },

  onNodesChange: (changes) =>
    set((state) => ({
      rfNodes: applyNodeChanges(changes, state.rfNodes),
    })),

  onEdgesChange: (changes) =>
    set((state) => ({
      rfEdges: applyEdgeChanges(changes, state.rfEdges),
    })),

  addNode: (n) =>
    set((state) => {
      if (state.rfNodes.some((x) => x.id === n.id)) return state;
      return { rfNodes: [...state.rfNodes, toRFNode(n)] };
    }),

  upsertNodeFromRemote: (n) =>
    set((state) => {
      const idx = state.rfNodes.findIndex((x) => x.id === n.id);
      // New node from a collaborator: reuse the same domain→RF mapping as load.
      if (idx === -1) {
        return { rfNodes: [...state.rfNodes, toRFNode(n)] };
      }
      // Existing node: rebuild it from the incoming NodeT so title/content/
      // color/parent and (Phase 2: always) position reflect the remote state.
      // Spread the existing RF node first to preserve any RF-managed fields
      // (selection, measured size, etc.) we don't own.
      const existing = state.rfNodes[idx];
      const incoming = toRFNode(n);
      const merged: IdeaRFNode = {
        ...existing,
        position: incoming.position,
        // Regions carry their box size + stacking on the RF node itself, so a
        // collaborator's resize/move reflects live (not just on reload).
        ...(incoming.type === 'region'
          ? {
              width: incoming.width,
              height: incoming.height,
              zIndex: incoming.zIndex,
            }
          : {}),
        data: {
          ...existing.data,
          ...incoming.data,
        },
      };
      const rfNodes = state.rfNodes.slice();
      rfNodes[idx] = merged;
      return { rfNodes };
    }),

  addEdge: (e) =>
    set((state) => {
      if (state.rfEdges.some((x) => x.id === e.id)) return state;
      return { rfEdges: [...state.rfEdges, toRFEdge(e)] };
    }),

  updateNodeContent: (nodeId, patch) =>
    set((state) => ({
      rfNodes: state.rfNodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.content !== undefined
                  ? { content: patch.content }
                  : {}),
              },
            }
          : n,
      ),
    })),

  removeNode: (nodeId) =>
    set((state) => ({
      rfNodes: state.rfNodes.filter((n) => n.id !== nodeId),
      rfEdges: state.rfEdges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId,
      ),
    })),

  removeEdge: (edgeId) =>
    set((state) => ({
      rfEdges: state.rfEdges.filter((e) => e.id !== edgeId),
    })),

  scheduleSavePosition: (nodeId) => {
    const existing = saveTimers.get(nodeId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      saveTimers.delete(nodeId);
      const { projectId, rfNodes } = get();
      if (!projectId) return;
      const node = rfNodes.find((n) => n.id === nodeId);
      if (!node) return;
      patchNode(projectId, nodeId, {
        data: { position: { x: node.position.x, y: node.position.y } },
      }).catch(() => {
        /* best-effort autosave; surfaced elsewhere if needed */
      });
    }, SAVE_DEBOUNCE_MS);
    saveTimers.set(nodeId, timer);
  },

  saveRegionBox: (nodeId, box) => {
    set((state) => ({
      rfNodes: state.rfNodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              position: { x: box.x, y: box.y },
              width: box.width,
              height: box.height,
              data: { ...n.data, width: box.width, height: box.height },
            }
          : n,
      ),
    }));
    const { projectId } = get();
    if (!projectId) return;
    patchNode(projectId, nodeId, {
      data: {
        position: { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
      },
    }).catch(() => {
      /* best-effort autosave */
    });
  },

  setRegionColor: (nodeId, color) => {
    set((state) => ({
      rfNodes: state.rfNodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, color } } : n,
      ),
    }));
    const { projectId } = get();
    if (!projectId) return;
    patchNode(projectId, nodeId, { data: { color } }).catch(() => {
      /* best-effort */
    });
  },

  applyLayout: async () => {
    const { projectId, rfNodes, rfEdges } = get();
    if (!projectId || rfNodes.length === 0) return;

    const regions = rfNodes.filter((n) => n.type === 'region');
    const others = rfNodes.filter((n) => n.type !== 'region');

    const sizeOf = (n: IdeaRFNode) => ({
      w: n.width ?? n.measured?.width ?? NODE_WIDTH,
      h: n.height ?? n.measured?.height ?? NODE_HEIGHT,
    });
    const regionBox = (r: IdeaRFNode) => ({
      x: r.position.x,
      y: r.position.y,
      w: r.width ?? r.data.width ?? DEFAULT_REGION_WIDTH,
      h: r.height ?? r.data.height ?? DEFAULT_REGION_HEIGHT,
    });

    // Geometric membership: a node belongs to the first region whose box
    // contains its center. Members ride along with their region during layout
    // instead of being scattered, so the region stays a coherent group.
    const memberOf = new Map<string, string>();
    for (const n of others) {
      const { w, h } = sizeOf(n);
      const cx = n.position.x + w / 2;
      const cy = n.position.y + h / 2;
      for (const r of regions) {
        const b = regionBox(r);
        if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
          memberOf.set(n.id, r.id);
          break;
        }
      }
    }

    const freeNodes = others.filter((n) => !memberOf.has(n.id));

    // Super-graph: free nodes at their real footprint + one block per region
    // (sized to the region box). Edges into a region are remapped to the block;
    // edges fully inside a region (or self-loops) are dropped.
    const superNodes: LayoutNodeInput[] = [
      ...freeNodes.map((n) => {
        const { w, h } = sizeOf(n);
        return { id: n.id, width: w, height: h };
      }),
      ...regions.map((r) => {
        const b = regionBox(r);
        return { id: r.id, width: b.w, height: b.h };
      }),
    ];
    if (superNodes.length === 0) return;

    const mapId = (id: string) => memberOf.get(id) ?? id;
    const superEdges = rfEdges
      .map((e) => ({ id: e.id, source: mapId(e.source), target: mapId(e.target) }))
      .filter((e) => e.source !== e.target);

    const { positions } = await layoutGraph(superNodes, superEdges);
    if (positions.size === 0) return;

    // Free nodes go to their elk position; each region (and all its members)
    // shifts by the region block's delta, preserving the inner arrangement.
    const finalPos = new Map<string, { x: number; y: number }>();
    for (const n of freeNodes) {
      const p = positions.get(n.id);
      if (p) finalPos.set(n.id, p);
    }
    for (const r of regions) {
      const p = positions.get(r.id);
      if (!p) continue;
      const dx = p.x - r.position.x;
      const dy = p.y - r.position.y;
      finalPos.set(r.id, { x: p.x, y: p.y });
      for (const n of others) {
        if (memberOf.get(n.id) === r.id) {
          finalPos.set(n.id, { x: n.position.x + dx, y: n.position.y + dy });
        }
      }
    }
    if (finalPos.size === 0) return;

    await beginHistoryBatch(projectId);
    set((state) => ({
      rfNodes: state.rfNodes.map((n) => {
        const p = finalPos.get(n.id);
        return p ? { ...n, position: { x: p.x, y: p.y } } : n;
      }),
    }));

    await Promise.allSettled(
      [...finalPos.entries()].map(([id, p]) =>
        patchNode(
          projectId,
          id,
          { data: { position: { x: p.x, y: p.y } } },
          { skipHistory: true },
        ),
      ),
    );
  },
}));
