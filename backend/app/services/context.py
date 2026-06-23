"""Context builders for brainstorm expansion.

Given a source node and a strategy, produce a concise textual context that is
injected into the expansion prompt:

- ``node``      : just the source node (title + truncated content).
- ``ancestors`` : the parent_id chain from the root down to the node, formatted
                  as an indented thread ("根 → … → 当前").
- ``full``      : a bullet outline of every node title in the project.

Long content is truncated to keep prompts small.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Node

_MAX_CONTENT_CHARS = 200
_MAX_ANCESTOR_HOPS = 50  # guard against cycles / runaway chains


def _truncate(text: str, limit: int = _MAX_CONTENT_CHARS) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…"


def _node_line(node: Node) -> str:
    content = _truncate(node.content)
    if content:
        return f"{node.title}：{content}"
    return node.title


async def _ancestor_chain(session: AsyncSession, node: Node) -> list[Node]:
    """Return nodes from root -> ... -> node (inclusive), in that order."""
    chain: list[Node] = [node]
    seen: set[str] = {node.id}
    current = node
    hops = 0
    while current.parent_id is not None and hops < _MAX_ANCESTOR_HOPS:
        parent = await session.get(Node, current.parent_id)
        if parent is None or parent.id in seen:
            break
        chain.append(parent)
        seen.add(parent.id)
        current = parent
        hops += 1
    chain.reverse()
    return chain


async def build_context(session: AsyncSession, node: Node, strategy: str) -> str:
    """Build context text for ``node`` using ``strategy``."""
    if strategy == "node":
        return _node_line(node)

    if strategy == "ancestors":
        chain = await _ancestor_chain(session, node)
        lines: list[str] = []
        for depth, n in enumerate(chain):
            indent = "  " * depth
            arrow = "" if depth == 0 else "→ "
            lines.append(f"{indent}{arrow}{_node_line(n)}")
        return "\n".join(lines)

    if strategy == "full":
        result = await session.execute(
            select(Node)
            .where(Node.project_id == node.project_id)
            .order_by(Node.created_at.asc())
        )
        nodes = list(result.scalars().all())
        lines = [f"- {n.title}" for n in nodes]
        body = "\n".join(lines)
        # Make the current node explicit at the end for the model's focus.
        return f"{body}\n\n（当前聚焦节点：{node.title}）" if body else _node_line(node)

    # Unknown strategy -> fall back to node.
    return _node_line(node)
