from __future__ import annotations

from dataclasses import dataclass
import mimetypes
from pathlib import Path

import anyio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.llm.image import DEFAULT_MIME_TYPE, ImageReference
from app.models import Edge, Node

_MAX_REFERENCE_IMAGES = 4
_MEDIA_URL_PREFIX = "/api/media/"


@dataclass(frozen=True, slots=True)
class ImageReferences:
    images: tuple[ImageReference, ...]
    urls: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _ResolvedReference:
    image: ImageReference
    url: str


def _is_image_node(node: Node) -> bool:
    data = node.data or {}
    return data.get("kind") == "image" and isinstance(data.get("image_url"), str)


def _media_path_from_url(image_url: str) -> Path | None:
    if not image_url.startswith(_MEDIA_URL_PREFIX):
        return None
    root = Path(get_settings().media_dir).resolve()
    path = (root / image_url.removeprefix(_MEDIA_URL_PREFIX)).resolve()
    if not path.is_relative_to(root):
        return None
    return path


def _read_reference_sync(node: Node) -> _ResolvedReference | None:
    data = node.data or {}
    image_url = data.get("image_url")
    if not isinstance(image_url, str):
        return None
    path = _media_path_from_url(image_url)
    if path is None or not path.is_file():
        return None
    try:
        image_bytes = path.read_bytes()
    except OSError:
        return None
    if not image_bytes:
        return None
    mime_type, _ = mimetypes.guess_type(path.name)
    return _ResolvedReference(
        image=ImageReference(
            filename=path.name,
            data=image_bytes,
            mime_type=mime_type or DEFAULT_MIME_TYPE,
        ),
        url=image_url,
    )


async def _read_reference(node: Node) -> _ResolvedReference | None:
    return await anyio.to_thread.run_sync(_read_reference_sync, node)


async def reference_images_for(session: AsyncSession, source: Node) -> ImageReferences:
    candidates: list[Node] = []
    seen_ids: set[str] = set()

    def append_candidate(node: Node) -> None:
        if node.id in seen_ids or not _is_image_node(node):
            return
        seen_ids.add(node.id)
        candidates.append(node)

    append_candidate(source)

    incoming_rows = await session.execute(
        select(Edge).where(
            Edge.project_id == source.project_id,
            Edge.target_id == source.id,
        )
    )
    for edge in incoming_rows.scalars().all():
        if len(candidates) >= _MAX_REFERENCE_IMAGES:
            break
        node = await session.get(Node, edge.source_id)
        if node is not None and node.project_id == source.project_id:
            append_candidate(node)

    resolved: list[_ResolvedReference] = []
    for node in candidates:
        if len(resolved) >= _MAX_REFERENCE_IMAGES:
            break
        reference = await _read_reference(node)
        if reference is not None:
            resolved.append(reference)

    return ImageReferences(
        images=tuple(reference.image for reference in resolved),
        urls=tuple(reference.url for reference in resolved),
    )
