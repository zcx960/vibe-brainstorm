import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  SelectionMode,
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
import { RegionList } from './RegionList';
import { CanvasContextMenu } from './CanvasContextMenu';
import type { CanvasContextMenuState } from './CanvasContextMenuParts';
import { DeleteConfirmDialog } from '../DeleteConfirmDialog';

export function Canvas() {
  // Drives React Flow's built-in dark styling (minimap, controls, background)
  // to match the app theme.
  const colorMode = useResolvedTheme();
  const { screenToFlowPosition, getViewport, setViewport } = useReactFlow();
  const rootRef = useRef<HTMLDivElement | null>(null);
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

  // Trackpad two-finger pan without losing mouse-wheel zoom. Wheel + zoom is the
  // React Flow default; here we intercept (in the capture phase, before RF) only
  // the events that look like a trackpad two-finger swipe and pan instead. A
  // mouse wheel notch (larger integer, vertical-only) and a trackpad pinch
  // (ctrl+wheel) both fall through to React Flow's zoom.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom -> let RF zoom
      const target = e.target as HTMLElement | null;
      if (target?.closest('.react-flow__minimap, .react-flow__controls')) return;

      // Distinguish a mouse wheel from a trackpad. The reliable signal: a
      // classic mouse wheel reports `wheelDeltaY` as a non-zero multiple of 120
      // (one notch = 120); a trackpad does not. Firefox lacks `wheelDeltaY`, so
      // fall back to deltaMode (line/page mode => wheel, pixel mode => trackpad).
      const wheelDeltaY = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
      const isMouseWheel =
        typeof wheelDeltaY === 'number' && wheelDeltaY !== 0
          ? Math.abs(wheelDeltaY) % 120 === 0
          : e.deltaMode !== 0;
      if (isMouseWheel) return; // mouse wheel -> let RF zoom

      // Trackpad two-finger swipe -> pan.
      e.preventDefault();
      e.stopPropagation();
      const vp = getViewport();
      setViewport({ x: vp.x - e.deltaX, y: vp.y - e.deltaY, zoom: vp.zoom });
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [getViewport, setViewport]);

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

  // Right-clicking an edge opens the menu with a delete-connection option.
  const openEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: { id: string }) => {
      event.preventDefault();
      event.stopPropagation();
      const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setContextMenu({
        screen: { x: event.clientX, y: event.clientY },
        flow: { x: flow.x, y: flow.y },
        targetNode: null,
        targetEdgeId: edge.id,
      });
    },
    [screenToFlowPosition],
  );

  // Persist position when a drag ends. A drag can move a whole multi-selection
  // (box-select then drag), so persist every selected node, not just the one
  // under the cursor — otherwise the others snap back on reload.
  const onNodeDragStop: OnNodeDrag<IdeaRFNode> = useCallback(
    (_evt, node) => {
      const ids = new Set<string>([node.id]);
      for (const n of useGraphStore.getState().rfNodes) {
        if (n.selected) ids.add(n.id);
      }
      ids.forEach((id) => scheduleSavePosition(id));
    },
    [scheduleSavePosition],
  );

  // Dragging a rubber-band selection fires this instead of onNodeDragStop.
  const onSelectionDragStop = useCallback(
    (_evt: ReactMouseEvent, nodes: IdeaRFNode[]) => {
      nodes.forEach((n) => scheduleSavePosition(n.id));
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
      // Regions are backboards — clicking just selects them. Everything else
      // (including galleries, for renaming) opens the side preview panel.
      if (node.type === 'region') return;
      openNodePreview(node.id);
    },
    [closeContextMenu, openNodePreview],
  );

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    // Don't hijack Backspace/Delete while the user is typing in a field
    // (e.g. renaming a region or editing a node) — that would pop the delete
    // dialog mid-edit.
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT')
    ) {
      return;
    }
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
    <div className="canvas-root" ref={rootRef}>
      <ReactFlow
        colorMode={colorMode}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStop={onSelectionDragStop}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onSelectionChange={onSelectionChange}
        onPaneClick={closeContextMenu}
        onPaneContextMenu={(event) => openContextMenu(event, null)}
        onNodeContextMenu={(event, node) => openContextMenu(event, node)}
        onEdgeContextMenu={(event, edge) => openEdgeContextMenu(event, edge)}
        deleteKeyCode={null}
        onKeyDown={onKeyDown}
        // Interaction model:
        //  - left drag on empty canvas -> rubber-band select for batch moving
        //  - middle mouse button drag  -> pan the canvas
        //  - mouse wheel               -> zoom (React Flow default)
        //  - trackpad two-finger swipe -> pan (custom wheel handler below);
        //    trackpad pinch (ctrl+wheel) -> zoom
        selectionOnDrag
        panOnDrag={[1]}
        selectionMode={SelectionMode.Partial}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <RegionList />
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
