from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Edge, Node, ProjectHistory
from app.schemas import EdgeOut, GraphOut, NodeOut

MAX_HISTORY_STEPS = 100


def _dt(value: datetime) -> str:
    return value.isoformat()


def _node_snapshot(node: Node) -> dict[str, Any]:
    return {
        "id": node.id,
        "project_id": node.project_id,
        "parent_id": node.parent_id,
        "title": node.title,
        "content": node.content,
        "data": dict(node.data or {}),
        "created_at": _dt(node.created_at),
    }


def _edge_snapshot(edge: Edge) -> dict[str, Any]:
    return {
        "id": edge.id,
        "project_id": edge.project_id,
        "source_id": edge.source_id,
        "target_id": edge.target_id,
        "data": dict(edge.data or {}),
    }


async def load_graph_snapshot(
    session: AsyncSession,
    project_id: str,
) -> dict[str, Any]:
    node_rows = await session.execute(
        select(Node).where(Node.project_id == project_id).order_by(Node.created_at.asc())
    )
    edge_rows = await session.execute(
        select(Edge).where(Edge.project_id == project_id)
    )
    return {
        "nodes": [_node_snapshot(node) for node in node_rows.scalars().all()],
        "edges": [_edge_snapshot(edge) for edge in edge_rows.scalars().all()],
    }


async def record_history(
    session: AsyncSession,
    project_id: str,
    action: str,
) -> None:
    snapshot = await load_graph_snapshot(session, project_id)
    session.add(
        ProjectHistory(
            project_id=project_id,
            action=action,
            snapshot=snapshot,
        )
    )
    await session.flush()
    await prune_history(session, project_id)


async def prune_history(session: AsyncSession, project_id: str) -> None:
    rows = await session.execute(
        select(ProjectHistory.id)
        .where(ProjectHistory.project_id == project_id)
        .order_by(ProjectHistory.created_at.desc(), ProjectHistory.id.desc())
        .offset(MAX_HISTORY_STEPS)
    )
    old_ids = list(rows.scalars().all())
    if not old_ids:
        return
    await session.execute(delete(ProjectHistory).where(ProjectHistory.id.in_(old_ids)))


async def history_count(session: AsyncSession, project_id: str) -> int:
    rows = await session.execute(
        select(ProjectHistory.id).where(ProjectHistory.project_id == project_id)
    )
    return len(rows.scalars().all())


async def restore_latest_history(
    session: AsyncSession,
    project_id: str,
) -> GraphOut | None:
    row = await session.execute(
        select(ProjectHistory)
        .where(ProjectHistory.project_id == project_id)
        .order_by(ProjectHistory.created_at.desc(), ProjectHistory.id.desc())
        .limit(1)
    )
    history = row.scalar_one_or_none()
    if history is None:
        return None

    snapshot = history.snapshot or {"nodes": [], "edges": []}
    nodes_data = list(snapshot.get("nodes") or [])
    edges_data = list(snapshot.get("edges") or [])

    await session.execute(delete(Edge).where(Edge.project_id == project_id))
    await session.execute(delete(Node).where(Node.project_id == project_id))
    await session.flush()

    for item in nodes_data:
        created_at = item.get("created_at")
        node = Node(
            id=item["id"],
            project_id=project_id,
            parent_id=item.get("parent_id"),
            title=item.get("title") or "未命名",
            content=item.get("content") or "",
            data=dict(item.get("data") or {}),
        )
        if isinstance(created_at, str):
            node.created_at = datetime.fromisoformat(created_at)
        session.add(node)

    await session.flush()

    for item in edges_data:
        session.add(
            Edge(
                id=item["id"],
                project_id=project_id,
                source_id=item["source_id"],
                target_id=item["target_id"],
                data=dict(item.get("data") or {}),
            )
        )

    await session.delete(history)
    await session.commit()

    restored = await load_graph_snapshot(session, project_id)
    return GraphOut(
        nodes=[node_out_from_snapshot(item) for item in restored["nodes"]],
        edges=[edge_out_from_snapshot(item) for item in restored["edges"]],
    )


async def capture_current_state(
    session: AsyncSession,
    project_id: str,
    action: str,
) -> None:
    await record_history(session, project_id, action)


def node_out_from_snapshot(item: dict[str, Any]) -> NodeOut:
    data = dict(item)
    created_at = data.get("created_at")
    if isinstance(created_at, str):
        data["created_at"] = datetime.fromisoformat(created_at)
    return NodeOut.model_validate(data)


def edge_out_from_snapshot(item: dict[str, Any]) -> EdgeOut:
    return EdgeOut.model_validate(dict(item))
