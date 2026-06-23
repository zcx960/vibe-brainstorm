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
  type OnSelectionChangeFunc,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useGraphStore, type IdeaRFNode } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { useResolvedTheme } from '../../store/themeStore';
import {
  beginHistoryBatch,
  createEdge,
  deleteNode,
  deleteEdge,
} from '../../api/projects';
import { sendPresence } from '../../realtime/ws';
import { nodeTypes } from './nodeTypes';
import { CanvasContextMenu } from './CanvasContextMenu';
import type { CanvasContextMenuState } from './CanvasContextMenuParts';
import { DeleteConfirmDialog } from '../DeleteConfirmDialog';

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
  const removeNode = useGraphStore((s) => s.removeNode);
  const removeEdge = useGraphStore((s) => s.removeEdge);
  const projectId = useGraphStore((s) => s.projectId);
  const reload = useGraphStore((s) => s.load);
  const closeDeleteConfirm = useUiStore((s) => s.closeDeleteConfirm);
  const openNodePreview = useUiStore((s) => s.openNodePreview);
  const openDeleteConfirmFromFlow = useUiStore(
    (s) => s.openDeleteConfirmFromFlow,
  );

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

  // Broadcast which node we have selected so collaborators can highlight it.
  // React Flow fires this with the full current selection; we report the first
  // selected node (or null when the selection is cleared).
  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes }) => {
    sendPresence({ type: 'presence.select', nodeId: nodes[0]?.id ?? null });
  }, []);

  const onNodeClick: NodeMouseHandler<IdeaRFNode> = useCallback(
    (_event, node) => {
      closeContextMenu();
      openNodePreview(node.id);
    },
    [closeContextMenu, openNodePreview],
  );

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const state = useGraphStore.getState();
    const selectedNodes = state.rfNodes.filter((node) => node.selected);
    const selectedEdges = state.rfEdges.filter((edge) => edge.selected);
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;
    event.preventDefault();
    openDeleteConfirmFromFlow({
      nodes: selectedNodes.map((node) => ({
        id: node.id,
        label:
          (node.data as { title?: string } | undefined)?.title ?? node.id,
      })),
      edges: selectedEdges.map((edge) => ({ id: edge.id })),
    });
  }, [openDeleteConfirmFromFlow]);

  const confirmDelete = useCallback(() => {
    const state = useUiStore.getState();
    if (!projectId) {
      state.closeDeleteConfirm();
      return;
    }
    const nodeIds = [...state.deleteConfirmNodeIds];
    const selectedNodeIds = new Set(nodeIds);
    const edgeIds = state.deleteConfirmEdgeIds.filter((id) => {
      const edge = useGraphStore.getState().rfEdges.find((item) => item.id === id);
      return !edge || (
        !selectedNodeIds.has(edge.source) &&
        !selectedNodeIds.has(edge.target)
      );
    });
    state.closeDeleteConfirm();

    void (async () => {
      await beginHistoryBatch(projectId);
      return Promise.allSettled([
        ...nodeIds.map((id) => deleteNode(projectId, id, { skipHistory: true })),
        ...edgeIds.map((id) => deleteEdge(projectId, id, { skipHistory: true })),
      ]);
    })().then((results) => {
      if (results.some((r) => r.status === 'rejected')) {
        pushToast('error', '部分删除失败，已刷新');
        reload(projectId);
      } else {
        nodeIds.forEach((id) => removeNode(id));
        edgeIds.forEach((id) => removeEdge(id));
        void useGraphStore.getState().refreshHistoryStatus(projectId);
      }
    }).catch(() => {
      pushToast('error', '删除失败，未修改画布');
    });
  }, [projectId, pushToast, reload, removeNode, removeEdge]);

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
        onNodeClick={onNodeClick}
        onSelectionChange={onSelectionChange}
        onPaneClick={closeContextMenu}
        onPaneContextMenu={(event) => openContextMenu(event, null)}
        onNodeContextMenu={(event, node) => openContextMenu(event, node)}
        deleteKeyCode={null}
        onKeyDown={onKeyDown}
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
      <DeleteConfirmDialog
        onConfirm={confirmDelete}
        onCancel={closeDeleteConfirm}
      />
    </div>
  );
}
