import type { IdeaRFNode } from '../../store/graphStore';

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasContextMenuState {
  readonly screen: CanvasPoint;
  readonly flow: CanvasPoint;
  readonly targetNode: IdeaRFNode | null;
}

interface MenuItemButtonProps {
  readonly icon: string;
  readonly label: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

export const MENU_WIDTH = 224;
export const MENU_NODE_HEIGHT = 356;
export const MENU_PANE_HEIGHT = 204;
export const VIEWPORT_GAP = 8;
export const CHILD_OFFSET_X = 300;
export const CHILD_OFFSET_Y = 40;

export function MenuItemButton({
  icon,
  label,
  danger = false,
  disabled = false,
  onClick,
}: MenuItemButtonProps) {
  const className = danger
    ? 'canvas-context-menu__item canvas-context-menu__item--danger'
    : 'canvas-context-menu__item';

  return (
    <button
      type="button"
      className={className}
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="canvas-context-menu__icon" aria-hidden>
        {icon}
      </span>
      <span className="canvas-context-menu__label">{label}</span>
    </button>
  );
}

export function clampToViewport(
  value: number,
  size: number,
  viewportSize: number,
) {
  return Math.max(
    VIEWPORT_GAP,
    Math.min(value, viewportSize - size - VIEWPORT_GAP),
  );
}

export function roundedPoint(point: CanvasPoint): CanvasPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

export function childPosition(parentNode: IdeaRFNode): CanvasPoint {
  return {
    x: Math.round(parentNode.position.x + CHILD_OFFSET_X),
    y: Math.round(parentNode.position.y + CHILD_OFFSET_Y),
  };
}

export function promptFromNode(node: IdeaRFNode): string {
  const lead = node.data.prompt || node.data.title;
  return [lead, node.data.content]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join('\n');
}
