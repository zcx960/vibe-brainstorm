from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.auth import get_current_user
from app.db import get_session
from app.models import Project, User
from app.permissions import ROLE_RANK, get_role
from app.schemas import EdgeOut, ImageGenerateRequest, NodeOut
from app.llm.image import GeneratedImage
from app.services.image_events import broadcast_created
from app.services.image_media import store_media
from app.services.imagegen import (
    ImageGenerationParams,
    JsonValue,
    run_image_generation,
)
from app.services.image_upload import (
    ImageNodePosition,
    ImageUploadError,
    ImageUploadInput,
    ImageUploadNodeParams,
    MAX_UPLOAD_BYTES,
    create_uploaded_image_node,
    validate_image_upload,
)
from app.services.history import record_history

router = APIRouter(prefix="/images", tags=["images"])


class ImageUploadOut(BaseModel):
    node: NodeOut
    edge: EdgeOut | None = None


class MediaUploadOut(BaseModel):
    url: str


def _sse(event: str, data: dict[str, JsonValue]) -> dict[str, str]:
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


async def _require_project_editor(
    session: AsyncSession, project_id: str, user: User
) -> None:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    role = await get_role(session, project_id, user.id)
    if role is None or ROLE_RANK.get(role, 0) < ROLE_RANK["editor"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")


def _clean_title(title: str, filename: str | None) -> str:
    cleaned = title.strip()
    if cleaned:
        return cleaned
    if filename:
        stem = filename.rsplit("/", 1)[-1].rsplit(".", 1)[0].strip()
        if stem:
            return stem
    return "图片"


@router.post("/generate")
async def generate_images(
    body: ImageGenerateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> EventSourceResponse:
    await _require_project_editor(session, body.project_id, user)

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


@router.post(
    "/upload",
    response_model=ImageUploadOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_image_node(
    file: UploadFile = File(...),
    project_id: str = Form(...),
    parent_id: str | None = Form(default=None),
    title: str = Form(default="图片"),
    content: str = Form(default=""),
    x: float = Form(default=0),
    y: float = Form(default=0),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> ImageUploadOut:
    await _require_project_editor(session, project_id, user)
    try:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        image = validate_image_upload(
            ImageUploadInput(
                filename=file.filename,
                content_type=file.content_type,
                data=data,
            )
        )
        await record_history(session, project_id, "image.upload")
        node, edge = await create_uploaded_image_node(
            session,
            ImageUploadNodeParams(
                project_id=project_id,
                parent_id=parent_id,
                title=_clean_title(title, file.filename),
                content=content.strip(),
                position=ImageNodePosition(x=x, y=y),
                image=image,
            ),
        )
    except ImageUploadError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    finally:
        await file.close()

    await broadcast_created(project_id, node=node, edge=edge, client_id=x_client_id)
    return ImageUploadOut(
        node=NodeOut.model_validate(node),
        edge=EdgeOut.model_validate(edge) if edge is not None else None,
    )


@router.post(
    "/upload-media",
    response_model=MediaUploadOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_media(
    file: UploadFile = File(...),
    project_id: str = Form(...),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MediaUploadOut:
    """Store an uploaded image in the media volume and return its URL, without
    creating a canvas node. Used by the gallery to add user-uploaded images."""
    await _require_project_editor(session, project_id, user)
    try:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        image = validate_image_upload(
            ImageUploadInput(
                filename=file.filename,
                content_type=file.content_type,
                data=data,
            )
        )
        _media_path, media_url = await store_media(
            project_id,
            GeneratedImage(
                data=image.data,
                mime_type=image.mime_type,
                prompt="",
            ),
        )
    except ImageUploadError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    finally:
        await file.close()

    return MediaUploadOut(url=media_url)
