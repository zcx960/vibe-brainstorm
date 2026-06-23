"""Brainstorm SSE endpoint.

``POST /api/brainstorm/expand`` streams Server-Sent Events as the model
generates ideas. Each generated child node is persisted before its ``idea``
event is emitted. Provider-availability and node-existence problems are surfaced
as a single ``error`` event (HTTP 200 stream), never as a 500.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.auth import get_current_user
from app.db import get_session
from app.models import Project, User
from app.permissions import ROLE_RANK, get_role
from app.schemas import ExpandRequest
from app.services.brainstorm import run_expansion

router = APIRouter(prefix="/brainstorm", tags=["brainstorm"])


def _sse(event: str, data: dict) -> dict:
    """Build an sse-starlette event payload with JSON-encoded data."""
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


@router.post("/expand")
async def expand(
    body: ExpandRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> EventSourceResponse:
    # The caller must be an editor member of the target project before streaming.
    project = await session.get(Project, body.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    role = await get_role(session, body.project_id, user.id)
    if role is None or ROLE_RANK.get(role, 0) < ROLE_RANK["editor"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    async def event_stream() -> AsyncIterator[dict]:
        async for event in run_expansion(
            session,
            project_id=body.project_id,
            node_id=body.node_id,
            mode=body.mode,
            provider_id=body.provider,
            model=body.model,
            count=body.count,
            instruction=body.instruction,
            context_strategy=body.context_strategy,
            client_id=x_client_id,
        ):
            yield _sse(event["event"], event["data"])

    return EventSourceResponse(event_stream())
