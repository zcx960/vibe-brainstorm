"""Graph endpoints: nodes and edges within a project."""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import DocComment, Edge, Node
from app.permissions import require_role
from app.realtime import manager
from app.schemas import (
    DocCommentCreate,
    DocCommentOut,
    EdgeCreate,
    EdgeOut,
    GraphOut,
    NodeCreate,
    NodeOut,
    NodeUpdate,
)
from app.services.export_docx import build_project_docx
from app.services.history import (
    edge_out_from_snapshot,
    history_count,
    list_history,
    load_graph_snapshot,
    node_out_from_snapshot,
    record_history,
    restore_history,
    restore_latest_history,
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
@router.get("/nodes/{node_id}", response_model=NodeOut)
async def get_node(
    project_id: str,
    node_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
) -> NodeOut:
    """Fetch a single node. Used by the standalone document editor page, which
    only carries the project + node ids in its URL."""
    node = await _get_node(session, project_id, node_id)
    return NodeOut.model_validate(node)


@router.post("/nodes", response_model=NodeOut, status_code=status.HTTP_201_CREATED)
async def create_node(
    project_id: str,
    body: NodeCreate,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    x_skip_history: str | None = Header(default=None, alias="X-Skip-History"),
) -> NodeOut:
    if body.parent_id is not None:
        # Validate parent belongs to project (best-effort; 404 if not found).
        await _get_node(session, project_id, body.parent_id)

    if not x_skip_history:
        await record_history(session, project_id, "node.create")
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
    x_skip_history: str | None = Header(default=None, alias="X-Skip-History"),
) -> NodeOut:
    node = await _get_node(session, project_id, node_id)
    fields = body.model_dump(exclude_unset=True)
    if not x_skip_history:
        await record_history(session, project_id, "node.update")
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


@router.delete("/nodes/{node_id}")
async def delete_node(
    project_id: str,
    node_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    x_skip_history: str | None = Header(default=None, alias="X-Skip-History"),
) -> Response:
    node = await _get_node(session, project_id, node_id)
    deleted_id = node.id  # capture before deletion
    if not x_skip_history:
        await record_history(session, project_id, "node.delete")

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
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# Document comments (collaborative annotations on document nodes)
# --------------------------------------------------------------------------- #
@router.get("/nodes/{node_id}/comments", response_model=list[DocCommentOut])
async def list_comments(
    project_id: str,
    node_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
) -> list[DocCommentOut]:
    await _get_node(session, project_id, node_id)
    rows = await session.execute(
        select(DocComment)
        .where(DocComment.node_id == node_id)
        .order_by(DocComment.created_at.asc())
    )
    return [DocCommentOut.model_validate(c) for c in rows.scalars().all()]


@router.post(
    "/nodes/{node_id}/comments",
    response_model=DocCommentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    project_id: str,
    node_id: str,
    body: DocCommentCreate,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> DocCommentOut:
    await _get_node(session, project_id, node_id)
    comment = DocComment(
        project_id=project_id,
        node_id=node_id,
        comment_id=body.comment_id,
        author_id=access.user.id,
        author_name=access.user.display_name,
        author_color=access.user.color,
        quote=body.quote or "",
        body=body.body,
    )
    session.add(comment)
    await session.commit()
    await session.refresh(comment)
    out = DocCommentOut.model_validate(comment)
    await manager.broadcast(
        project_id,
        {
            "type": "comment.created",
            "origin": x_client_id,
            "payload": {"comment": out.model_dump(mode="json")},
        },
        exclude_client=x_client_id,
    )
    return out


@router.delete("/nodes/{node_id}/comments/{comment_id}")
async def delete_comment(
    project_id: str,
    node_id: str,
    comment_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> Response:
    # ``comment_id`` is the mark id shared with the document, not the row PK.
    rows = await session.execute(
        select(DocComment).where(
            DocComment.node_id == node_id,
            DocComment.comment_id == comment_id,
        )
    )
    comments = rows.scalars().all()
    if not comments:
        raise HTTPException(status_code=404, detail="Comment not found")
    for comment in comments:
        await session.delete(comment)
    await session.commit()
    await manager.broadcast(
        project_id,
        {
            "type": "comment.deleted",
            "origin": x_client_id,
            "payload": {"comment_id": comment_id, "node_id": node_id},
        },
        exclude_client=x_client_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
    x_skip_history: str | None = Header(default=None, alias="X-Skip-History"),
) -> EdgeOut:
    # Validate endpoints exist within the project.
    await _get_node(session, project_id, body.source_id)
    await _get_node(session, project_id, body.target_id)

    if not x_skip_history:
        await record_history(session, project_id, "edge.create")
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


@router.delete("/edges/{edge_id}")
async def delete_edge(
    project_id: str,
    edge_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    x_skip_history: str | None = Header(default=None, alias="X-Skip-History"),
) -> Response:
    edge = await _get_edge(session, project_id, edge_id)
    deleted_id = edge.id  # capture before deletion
    if not x_skip_history:
        await record_history(session, project_id, "edge.delete")
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
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# History
# --------------------------------------------------------------------------- #
@router.get("/history")
async def get_history_status(
    project_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, int | bool]:
    count = await history_count(session, project_id)
    return {"can_undo": count > 0, "count": count}


@router.get("/history/list")
async def get_history_list(
    project_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
) -> dict[str, list[dict]]:
    """Recent restore points (newest first), for the history dropdown."""
    entries = await list_history(session, project_id, limit=10)
    return {"entries": entries}


@router.post("/history/undo", response_model=GraphOut)
async def undo_history(
    project_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> GraphOut:
    restored = await restore_latest_history(session, project_id)
    if restored is None:
        raise HTTPException(status_code=409, detail="没有可回退的历史记录")

    payload = restored.model_dump(mode="json")
    await manager.broadcast(
        project_id,
        {
            "type": "graph.restored",
            "origin": x_client_id,
            "payload": payload,
        },
        exclude_client=x_client_id,
    )
    return restored


@router.post("/history/restore/{history_id}", response_model=GraphOut)
async def restore_history_point(
    project_id: str,
    history_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> GraphOut:
    """Roll the project back to a specific restore point (and every change made
    after it)."""
    restored = await restore_history(session, project_id, history_id)
    if restored is None:
        raise HTTPException(status_code=404, detail="找不到该历史记录")

    payload = restored.model_dump(mode="json")
    await manager.broadcast(
        project_id,
        {
            "type": "graph.restored",
            "origin": x_client_id,
            "payload": payload,
        },
        exclude_client=x_client_id,
    )
    return restored


@router.post("/history/snapshot")
async def snapshot_history(
    project_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await record_history(session, project_id, "manual.snapshot")
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/history/begin")
async def begin_history_batch(
    project_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await record_history(session, project_id, "batch.begin")
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #
@router.get("/export.docx")
async def export_project_docx(
    project_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    snapshot = await load_graph_snapshot(session, project_id)
    graph = GraphOut(
        nodes=[node_out_from_snapshot(item) for item in snapshot["nodes"]],
        edges=[edge_out_from_snapshot(item) for item in snapshot["edges"]],
    )
    content = build_project_docx(access.project.name, graph)
    filename = f"{access.project.name or 'brainstorm'}.docx"
    encoded = quote(filename)
    return Response(
        content=content,
        media_type=(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        headers={
            "Content-Disposition": (
                f"attachment; filename*=UTF-8''{encoded}"
            )
        },
    )
