from __future__ import annotations

import uuid
from pathlib import Path

import anyio

from app.config import get_settings
from app.llm.image import GeneratedImage

_MIME_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _media_extension(mime_type: str) -> str:
    return _MIME_EXTENSIONS.get(mime_type.lower(), ".png")


def _write_media_file(
    media_dir: str, project_id: str, image: GeneratedImage
) -> tuple[str, str]:
    ext = _media_extension(image.mime_type)
    root = Path(media_dir)
    relative = Path("images") / project_id / f"{uuid.uuid4()}{ext}"
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(image.data)
    return str(target), "/api/media/" + relative.as_posix()


async def store_media(project_id: str, image: GeneratedImage) -> tuple[str, str]:
    return await anyio.to_thread.run_sync(
        _write_media_file,
        get_settings().media_dir,
        project_id,
        image,
    )
