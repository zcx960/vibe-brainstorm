from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.image import GeneratedImage
from app.models import Edge, Node
from app.services.image_media import store_media

MAX_UPLOAD_BYTES: Final = 25 * 1024 * 1024
SUPPORTED_UPLOAD_MIME_TYPES: Final = frozenset(
    {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}
)


class ImageUploadError(RuntimeError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class ImageUploadInput:
    filename: str | None
    content_type: str | None
    data: bytes


@dataclass(frozen=True, slots=True)
class ValidatedImageUpload:
    filename: str | None
    mime_type: str
    data: bytes


@dataclass(frozen=True, slots=True)
class ImageNodePosition:
    x: float
    y: float

    def as_json(self) -> dict[str, float]:
        return {"x": self.x, "y": self.y}


@dataclass(frozen=True, slots=True)
class ImageUploadNodeParams:
    project_id: str
    parent_id: str | None
    title: str
    content: str
    position: ImageNodePosition
    image: ValidatedImageUpload


def validate_image_upload(upload: ImageUploadInput) -> ValidatedImageUpload:
    if not upload.data:
        raise ImageUploadError("图片文件为空")
    if len(upload.data) > MAX_UPLOAD_BYTES:
        raise ImageUploadError("图片不能超过 25MB", status_code=413)

    declared_mime = _normalize_mime(upload.content_type)
    sniffed_mime = _sniff_mime(upload.data)
    if sniffed_mime is None:
        raise ImageUploadError("上传的文件不是有效图片")

    if declared_mime not in SUPPORTED_UPLOAD_MIME_TYPES:
        declared_mime = sniffed_mime

    declared_mime = _normalize_mime(declared_mime)
    if declared_mime != sniffed_mime:
        raise ImageUploadError("图片格式与文件内容不匹配")

    return ValidatedImageUpload(
        filename=upload.filename,
        mime_type=declared_mime,
        data=upload.data,
    )


async def create_uploaded_image_node(
    session: AsyncSession,
    params: ImageUploadNodeParams,
) -> tuple[Node, Edge | None]:
    parent = await _get_parent(session, params.project_id, params.parent_id)
    prompt = params.content or params.title
    media_path, media_url = await store_media(
        params.project_id,
        GeneratedImage(
            data=params.image.data,
            mime_type=params.image.mime_type,
            prompt=prompt,
        ),
    )
    node = Node(
        project_id=params.project_id,
        parent_id=params.parent_id,
        title=params.title,
        content=params.content,
        data={
            "kind": "image",
            "position": params.position.as_json(),
            "image_url": media_url,
            "media_path": media_path,
            "prompt": prompt,
            "source": "upload",
            "uploaded_filename": params.image.filename,
        },
    )
    session.add(node)
    await session.flush()

    edge: Edge | None = None
    if parent is not None:
        edge = Edge(
            project_id=params.project_id,
            source_id=parent.id,
            target_id=node.id,
            data={"kind": "image"},
        )
        session.add(edge)
        await session.flush()

    await session.commit()
    await session.refresh(node)
    if edge is not None:
        await session.refresh(edge)
    return node, edge


async def _get_parent(
    session: AsyncSession, project_id: str, parent_id: str | None
) -> Node | None:
    if parent_id is None:
        return None
    parent = await session.get(Node, parent_id)
    if parent is None or parent.project_id != project_id:
        raise ImageUploadError("父节点不存在", status_code=404)
    return parent


def _normalize_mime(content_type: str | None) -> str:
    mime_type = (content_type or "").split(";", 1)[0].strip().lower()
    if mime_type == "image/jpg":
        return "image/jpeg"
    return mime_type


def _sniff_mime(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None
