import { useEffect, useRef, type ChangeEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { IdeaRFNode } from '../../store/graphStore';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { beginHistoryBatch, createEdge, createNode } from '../../api/projects';
import { uploadImageNode } from '../../api/images';
import {
  MenuItemButton,
  childPosition,
  clampToViewport,
  promptFromNode,
  roundedPoint,
  MENU_NODE_HEIGHT,
  MENU_PANE_HEIGHT,
  MENU_WIDTH,
  type CanvasContextMenuState,
} from './CanvasContextMenuParts';

interface CanvasContextMenuProps {
  readonly menu: CanvasContextMenuState;
  readonly onClose: () => void;
}

export function CanvasContextMenu({
  menu,
  onClose,
}: CanvasContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadParentRef = useRef<IdeaRFNode | null>(null);
  const { fitView } = useReactFlow();

  const projectId = useGraphStore((s) => s.projectId);
  const addNode = useGraphStore((s) => s.addNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const applyLayout = useGraphStore((s) => s.applyLayout);
  const refreshHistoryStatus = useGraphStore((s) => s.refreshHistoryStatus);

  const openExpandPanel = useUiStore((s) => s.openExpandPanel);
  const openImagePanel = useUiStore((s) => s.openImagePanel);
  const openDeleteConfirm = useUiStore((s) => s.openDeleteConfirm);
  const pushToast = useUiStore((s) => s.pushToast);

  const targetNode = menu.targetNode;
  const menuHeight = targetNode ? MENU_NODE_HEIGHT : MENU_PANE_HEIGHT;
  const left = clampToViewport(menu.screen.x, MENU_WIDTH, window.innerWidth);
  const top = clampToViewport(menu.screen.y, menuHeight, window.innerHeight);

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target)
      ) {
        return;
      }
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const handleCreateNode = async (parentNode: IdeaRFNode | null) => {
    if (!projectId) return;
    onClose();

    const position = parentNode ? childPosition(parentNode) : roundedPoint(menu.flow);

    try {
      if (parentNode) {
        await beginHistoryBatch(projectId);
      }
      const node = await createNode(projectId, {
        parent_id: parentNode?.id ?? null,
        title: parentNode ? '新子节点' : '新想法',
        content: '',
        data: { position },
      }, {
        skipHistory: Boolean(parentNode),
      });
      addNode(node);
      void refreshHistoryStatus(projectId);

      if (!parentNode) return;

      try {
        const edge = await createEdge(projectId, {
          source_id: parentNode.id,
          target_id: node.id,
        }, {
          skipHistory: true,
        });
        addEdge(edge);
        void refreshHistoryStatus(projectId);
      } catch {
        pushToast('error', '子节点已创建，但连线失败');
      }
    } catch {
      pushToast('error', parentNode ? '新建子节点失败' : '新建节点失败');
    }
  };

  const handlePickImageFile = (parentNode: IdeaRFNode | null) => {
    uploadParentRef.current = parentNode;
    fileInputRef.current?.click();
  };

  const handleImageFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!projectId) {
      pushToast('error', '请先选择项目');
      return;
    }

    const parentNode = uploadParentRef.current;
    uploadParentRef.current = null;
    const position = parentNode ? childPosition(parentNode) : roundedPoint(menu.flow);

    onClose();
    try {
      const result = await uploadImageNode({
        project_id: projectId,
        parent_id: parentNode?.id ?? null,
        title: titleFromFile(file),
        content: '',
        position,
        file,
      });
      addNode(result.node);
      if (result.edge) addEdge(result.edge);
      void refreshHistoryStatus(projectId);
      pushToast('success', '已添加图片节点');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : '上传图片失败');
    }
  };

  const handleLayout = async () => {
    onClose();
    try {
      await applyLayout();
      if (projectId) void refreshHistoryStatus(projectId);
      window.setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 50);
    } catch {
      pushToast('error', '整理布局失败');
    }
  };

  const handleFitView = () => {
    onClose();
    fitView({ padding: 0.25, duration: 400 });
  };

  const handleOpenExpandPanel = () => {
    if (!targetNode) return;
    onClose();
    openExpandPanel(targetNode.id);
  };

  const handleOpenImagePanel = () => {
    if (!targetNode) return;
    onClose();
    openImagePanel(targetNode.id, promptFromNode(targetNode));
  };

  const handleDeleteNode = () => {
    if (!targetNode) return;
    onClose();
    openDeleteConfirm(
      targetNode.id,
      targetNode.data.title || targetNode.id || '未命名节点',
    );
  };

  return (
    <div
      ref={rootRef}
      className="canvas-context-menu nodrag"
      role="menu"
      aria-label="画布右键菜单"
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <input
        ref={fileInputRef}
        className="canvas-context-menu__file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => {
          void handleImageFileChange(event);
        }}
      />
      {targetNode && (
        <div className="canvas-context-menu__target" title={targetNode.data.title}>
          {targetNode.data.title || '未命名'}
        </div>
      )}

      {targetNode ? (
        <>
          <MenuItemButton
            icon="+"
            label="添加子节点"
            onClick={() => {
              void handleCreateNode(targetNode);
            }}
          />
          <MenuItemButton
            icon="▧"
            label="上传图片子节点"
            onClick={() => handlePickImageFile(targetNode)}
          />
          <MenuItemButton
            icon="*"
            label="脑爆扩展"
            onClick={handleOpenExpandPanel}
          />
          <MenuItemButton
            icon="□"
            label="生图扩展"
            onClick={handleOpenImagePanel}
          />
          <div className="canvas-context-menu__divider" role="separator" />
          <MenuItemButton
            icon="×"
            label="删除节点"
            danger
            onClick={handleDeleteNode}
          />
          <div className="canvas-context-menu__divider" role="separator" />
        </>
      ) : (
        <>
          <MenuItemButton
            icon="+"
            label="在此添加节点"
            onClick={() => {
              void handleCreateNode(null);
            }}
          />
          <MenuItemButton
            icon="▧"
            label="上传图片节点"
            onClick={() => handlePickImageFile(null)}
          />
        </>
      )}

      <MenuItemButton
        icon="↦"
        label="整理布局"
        onClick={() => {
          void handleLayout();
        }}
      />
      <MenuItemButton
        icon="⌖"
        label="适配视图"
        onClick={handleFitView}
      />
    </div>
  );
}

function titleFromFile(file: File): string {
  const stem = file.name.replace(/\.[^.]+$/, '').trim();
  return stem || '图片';
}
