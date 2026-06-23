import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  type OnNodeDrag,
  type OnConnect,
  type OnNodesDelete,
  type OnEdgesDelete,
  type OnSelectionChangeFunc,
} from '@xyflow/react';
import { useGraphStore, type IdeaRFNode } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { useResolvedTheme } from '../../store/themeStore';
import { createEdge, deleteNode, deleteEdge } from '../../api/projects';
import { sendPresence } from '../../realtime/ws';
import { nodeTypes } from './nodeTypes';
import { CanvasContextMenu } from './CanvasContextMenu';
import type { CanvasContextMenuState } from './CanvasContextMenuParts';

export function Canvas() {
  // Drives React Flow's built-in dark styling (minimap, controls, background)
  // to match the app theme.
  const colorMode = useResolvedTheme();
  const { screenToFlowPosition } = useReactFlow();
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const rfEdges = useGraphStore((s) => s.rfEdges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const scheduleSavePosition = useGraphStore((s) => s.scheduleSavePosition);
  const addEdge = useGraphStore((s) => s.addEdge);
  const projectId = useGraphStore((s) => s.projectId);
  const reload = useGraphStore((s) => s.load);

  const pushToast = useUiStore((s) => s.pushToast);
  const [contextMenu, setContextMenu] =
    useState<CanvasContextMenuState | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openContextMenu = useCallback(
    (
      event:
        | MouseEvent
        | ReactMouseEvent<Element, MouseEvent>,
      targetNode: IdeaRFNode | null,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const flow = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setContextMenu({
        screen: { x: event.clientX, y: event.clientY },
        flow: { x: flow.x, y: flow.y },
        targetNode,
      });
    },
    [screenToFlowPosition],
  );

  // Persist position when a drag ends.
  const onNodeDragStop: OnNodeDrag<IdeaRFNode> = useCallback(
    (_evt, node) => {
      scheduleSavePosition(node.id);
    },
    [scheduleSavePosition],
  );

  // Manual edge creation by dragging between handles.
  const onConnect: OnConnect = useCallback(
    (conn) => {
      if (!projectId || !conn.source || !conn.target) return;
      if (conn.source === conn.target) return;
      createEdge(projectId, {
        source_id: conn.source,
        target_id: conn.target,
      })
        .then((edge) => addEdge(edge))
        .catch(() => pushToast('error', '创建连线失败'));
    },
    [projectId, addEdge, pushToast],
  );

  // Persist deletions triggered via Delete/Backspace or a node's × button.
  // React Flow has already removed them from the canvas via onNodesChange;
  // here we just sync the backend (and reload on failure to stay consistent).
  const onNodesDelete: OnNodesDelete = useCallback(
    (deleted) => {
      if (!projectId) return;
      Promise.allSettled(deleted.map((n) => deleteNode(projectId, n.id))).then(
        (results) => {
          if (results.some((r) => r.status === 'rejected')) {
            pushToast('error', '部分节点删除失败，已刷新');
            reload(projectId);
          }
        },
      );
    },
    [projectId, pushToast, reload],
  );

  // Edges removed as a side effect of a node deletion are already cascaded
  // server-side, so failures here (404 on an already-gone edge) are ignored.
  const onEdgesDelete: OnEdgesDelete = useCallback(
    (deleted) => {
      if (!projectId) return;
      deleted.forEach((e) => deleteEdge(projectId, e.id).catch(() => {}));
    },
    [projectId],
  );

  // Broadcast which node we have selected so collaborators can highlight it.
  // React Flow fires this with the full current selection; we report the first
  // selected node (or null when the selection is cleared).
  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes }) => {
    sendPresence({ type: 'presence.select', nodeId: nodes[0]?.id ?? null });
  }, []);

  return (
    <div className="canvas-root">
      <ReactFlow
        colorMode={colorMode}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onSelectionChange={onSelectionChange}
        onPaneClick={closeContextMenu}
        onPaneContextMenu={(event) => openContextMenu(event, null)}
        onNodeContextMenu={(event, node) => openContextMenu(event, node)}
        deleteKeyCode={['Delete', 'Backspace']}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            (n.data as { color?: string } | undefined)?.color || '#c7d2fe'
          }
          nodeStrokeWidth={2}
        />
      </ReactFlow>
      {contextMenu && (
        <CanvasContextMenu
          menu={contextMenu}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
