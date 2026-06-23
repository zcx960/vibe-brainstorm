from __future__ import annotations

from app.models import Node

_X_SPACING = 300.0
_Y_DROP = 220.0


def parent_position(node: Node) -> tuple[float, float]:
    data = node.data or {}
    pos = data.get("position") or {}
    try:
        x = float(pos.get("x", 0.0))
    except (AttributeError, TypeError, ValueError):
        x = 0.0
    try:
        y = float(pos.get("y", 0.0))
    except (AttributeError, TypeError, ValueError):
        y = 0.0
    return x, y


def child_position(parent: Node, index: int, count: int) -> dict[str, float]:
    px, py = parent_position(parent)
    return {
        "x": px + (index - (count - 1) / 2) * _X_SPACING,
        "y": py + _Y_DROP,
    }
