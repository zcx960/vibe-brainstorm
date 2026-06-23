import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';

const elk = new ELK();

// Default card footprint used for layout when a node hasn't been measured yet.
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 120;

const ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  'elk.spacing.nodeNode': '60',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

/**
 * Run an elkjs `layered` (top-down) layout over the given React Flow nodes and
 * edges. Returns a map of nodeId -> new top-left position. The caller decides
 * whether to apply and/or persist them.
 */
export async function layoutGraph(
  nodes: Node[],
  edges: Edge[],
): Promise<LayoutResult> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return { positions };

  const graph = {
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children: nodes.map((n) => ({
      id: n.id,
      width: n.width ?? n.measured?.width ?? NODE_WIDTH,
      height: n.height ?? n.measured?.height ?? NODE_HEIGHT,
    })),
    // Only include edges whose endpoints exist, or ELK will throw.
    edges: edges
      .filter(
        (e) =>
          nodes.some((n) => n.id === e.source) &&
          nodes.some((n) => n.id === e.target),
      )
      .map((e) => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      })),
  };

  const laidOut = await elk.layout(graph);
  for (const child of laidOut.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }
  return { positions };
}
