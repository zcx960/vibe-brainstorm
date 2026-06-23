import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import type { NodeT, EdgeT, GraphResponse } from '../types';
import { getGraph, patchNode } from '../api/projects';
import { layoutGraph } from '../lib/layout';

// The data we hang on each React Flow node (consumed by IdeaNode / ImageNode).
export interface RFNodeData extends Record<string, unknown> {
  nodeId: string;
  title: string;
  content: string;
  color?: string;
  parentId: string | null;
  // Image nodes carry these (kind === 'image').
  kind?: 'idea' | 'image';
  imageUrl?: string;
  prompt?: string;
  referenceImageUrls?: string[];
}

// Idea and image nodes share the same data shape; only the RF `type` differs so
// React Flow renders the right component. Keep one node type alias so existing
// store code (load, upsert, layout, changes) flows through unchanged.
export type IdeaRFNode = RFNode<RFNodeData, 'idea' | 'image'>;

// ---- conversions between domain types and React Flow types ----

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length > 0 ? strings : undefined;
}

export function toRFNode(n: NodeT): IdeaRFNode {
  const kind = n.data?.kind === 'image' ? 'image' : 'idea';
  return {
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
    },
  };
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

  load: (projectId: string) => Promise<void>;
  clear: () => void;

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

  load: async (projectId) => {
    set({ loading: true, projectId });
    try {
      const graph: GraphResponse = await getGraph(projectId);
      set({
        rfNodes: graph.nodes.map(toRFNode),
        rfEdges: graph.edges.map(toRFEdge),
        loading: false,
      });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  clear: () => set({ rfNodes: [], rfEdges: [], projectId: null }),

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

  applyLayout: async () => {
    const { projectId, rfNodes, rfEdges } = get();
    if (!projectId || rfNodes.length === 0) return;

    const { positions } = await layoutGraph(rfNodes, rfEdges);

    // Apply positions to the in-memory graph.
    set((state) => ({
      rfNodes: state.rfNodes.map((n) => {
        const p = positions.get(n.id);
        return p ? { ...n, position: { x: p.x, y: p.y } } : n;
      }),
    }));

    // Persist each new position (fire and forget, in parallel).
    await Promise.allSettled(
      [...positions.entries()].map(([id, p]) =>
        patchNode(projectId, id, { data: { position: { x: p.x, y: p.y } } }),
      ),
    );
  },
}));
