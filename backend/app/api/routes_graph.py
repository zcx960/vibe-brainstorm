"""Graph endpoints: nodes and edges within a project."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Edge, Node
from app.permissions import require_role
from app.realtime import manager
from app.schemas import (
    EdgeCreate,
    EdgeOut,
    GraphOut,
    NodeCreate,
    NodeOut,
    NodeUpdate,
)

router = APIRouter(prefix="/projects/{project_id}", tags=["graph"])


async def _get_node(session: AsyncSession, project_id: str, node_id: str) -> Node:
    node = await session.get(Node, node_id)
    if node is None or node.project_id != project_id:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


async def _get_edge(session: AsyncSession, project_id: str, edge_id: str) -> Edge:
    edge = await session.get(Edge, edge_id)
    if edge is None or edge.project_id != project_id:
        raise HTTPException(status_code=404, detail="Edge not found")
    return edge


def _ensure_position(data: dict | None) -> dict:
    data = dict(data or {})
    if "position" not in data or not isinstance(data.get("position"), dict):
        data["position"] = {"x": 0.0, "y": 0.0}
    return data


def _merge_data(current: dict | None, patch: dict) -> dict:
    merged = dict(current or {})
    merged.update(patch)
    return _ensure_position(merged)


# --------------------------------------------------------------------------- #
# Graph read
# --------------------------------------------------------------------------- #
@router.get("/graph", response_model=GraphOut)
async def get_graph(
    project_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
) -> GraphOut:
    node_rows = await session.execute(
        select(Node).where(Node.project_id == project_id).order_by(Node.created_at.asc())
    )
    edge_rows = await session.execute(
        select(Edge).where(Edge.project_id == project_id)
    )
    nodes = [NodeOut.model_validate(n) for n in node_rows.scalars().all()]
    edges = [EdgeOut.model_validate(e) for e in edge_rows.scalars().all()]
    return GraphOut(nodes=nodes, edges=edges)


# --------------------------------------------------------------------------- #
# Nodes
# --------------------------------------------------------------------------- #
@router.post("/nodes", response_model=NodeOut, status_code=status.HTTP_201_CREATED)
async def create_node(
    project_id: str,
    body: NodeCreate,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> NodeOut:
    if body.parent_id is not None:
        # Validate parent belongs to project (best-effort; 404 if not found).
        await _get_node(session, project_id, body.parent_id)

    node = Node(
        project_id=project_id,
        parent_id=body.parent_id,
        title=body.title,
        content=body.content or "",
        data=_ensure_position(body.data),
    )
    session.add(node)
    await session.commit()
    await session.refresh(node)
    out = NodeOut.model_validate(node)
    await manager.broadcast(
        project_id,
        {
            "type": "node.created",
            "origin": x_client_id,
            "payload": {"node": out.model_dump(mode="json")},
        },
        exclude_client=x_client_id,
    )
    return out


@router.patch("/nodes/{node_id}", response_model=NodeOut)
async def update_node(
    project_id: str,
    node_id: str,
    body: NodeUpdate,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> NodeOut:
    node = await _get_node(session, project_id, node_id)
    fields = body.model_dump(exclude_unset=True)
    if "title" in fields and fields["title"] is not None:
        node.title = fields["title"]
    if "content" in fields and fields["content"] is not None:
        node.content = fields["content"]
    if "data" in fields and fields["data"] is not None:
        node.data = _merge_data(node.data, fields["data"])
    if "parent_id" in fields:
        node.parent_id = fields["parent_id"]  # may be set to None explicitly
    await session.commit()
    await session.refresh(node)
    out = NodeOut.model_validate(node)
    await manager.broadcast(
        project_id,
        {
            "type": "node.updated",
            "origin": x_client_id,
            "payload": {"node": out.model_dump(mode="json")},
        },
        exclude_client=x_client_id,
    )
    return out


@router.delete("/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(
    project_id: str,
    node_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> None:
    node = await _get_node(session, project_id, node_id)
    deleted_id = node.id  # capture before deletion

    # Detach children (portable equivalent of ON DELETE SET NULL).
    child_rows = await session.execute(
        select(Node).where(Node.parent_id == node_id)
    )
    for child in child_rows.scalars().all():
        child.parent_id = None

    # Remove incident edges (portable equivalent of ON DELETE CASCADE).
    edge_rows = await session.execute(
        select(Edge).where(
            Edge.project_id == project_id,
            or_(Edge.source_id == node_id, Edge.target_id == node_id),
        )
    )
    for edge in edge_rows.scalars().all():
        await session.delete(edge)

    await session.delete(node)
    await session.commit()
    await manager.broadcast(
        project_id,
        {
            "type": "node.deleted",
            "origin": x_client_id,
            "payload": {"node_id": deleted_id},
        },
        exclude_client=x_client_id,
    )


# --------------------------------------------------------------------------- #
# Edges
# --------------------------------------------------------------------------- #
@router.post("/edges", response_model=EdgeOut, status_code=status.HTTP_201_CREATED)
async def create_edge(
    project_id: str,
    body: EdgeCreate,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> EdgeOut:
    # Validate endpoints exist within the project.
    await _get_node(session, project_id, body.source_id)
    await _get_node(session, project_id, body.target_id)

    edge = Edge(
        project_id=project_id,
        source_id=body.source_id,
        target_id=body.target_id,
        data=dict(body.data or {}),
    )
    session.add(edge)
    await session.commit()
    await session.refresh(edge)
    out = EdgeOut.model_validate(edge)
    await manager.broadcast(
        project_id,
        {
            "type": "edge.created",
            "origin": x_client_id,
            "payload": {"edge": out.model_dump(mode="json")},
        },
        exclude_client=x_client_id,
    )
    return out


@router.delete("/edges/{edge_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_edge(
    project_id: str,
    edge_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> None:
    edge = await _get_edge(session, project_id, edge_id)
    deleted_id = edge.id  # capture before deletion
    await session.delete(edge)
    await session.commit()
    await manager.broadcast(
        project_id,
        {
            "type": "edge.deleted",
            "origin": x_client_id,
            "payload": {"edge_id": deleted_id},
        },
        exclude_client=x_client_id,
    )
