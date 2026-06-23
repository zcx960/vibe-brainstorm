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
from app.schemas import ImageGenerateRequest
from app.services.imagegen import (
    ImageGenerationParams,
    JsonValue,
    run_image_generation,
)

router = APIRouter(prefix="/images", tags=["images"])


def _sse(event: str, data: dict[str, JsonValue]) -> dict[str, str]:
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


@router.post("/generate")
async def generate_images(
    body: ImageGenerateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> EventSourceResponse:
    project = await session.get(Project, body.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    role = await get_role(session, body.project_id, user.id)
    if role is None or ROLE_RANK.get(role, 0) < ROLE_RANK["editor"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    async def event_stream() -> AsyncIterator[dict[str, str]]:
        async for event in run_image_generation(
            session,
            ImageGenerationParams(
                project_id=body.project_id,
                node_id=body.node_id,
                provider_id=body.provider,
                model=body.model,
                count=body.count,
                prompt=body.prompt,
                size=body.size,
                client_id=x_client_id,
            ),
        ):
            yield _sse(str(event["event"]), event["data"])

    return EventSourceResponse(event_stream())
