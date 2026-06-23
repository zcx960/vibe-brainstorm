from __future__ import annotations

import base64
import binascii
import mimetypes
import urllib.request
from dataclasses import dataclass
from typing import Final, TypeAlias

import anyio

DEFAULT_MIME_TYPE: Final = "image/png"
ImageFile: TypeAlias = tuple[str, bytes, str]


@dataclass(frozen=True, slots=True)
class GeneratedImage:
    data: bytes
    mime_type: str
    prompt: str


@dataclass(frozen=True, slots=True)
class ImageReference:
    filename: str
    data: bytes
    mime_type: str


class ImageProviderError(RuntimeError):
    pass


class OpenAICompatibleImageProvider:
    def __init__(self, base_url: str, api_key: str) -> None:
        from openai import AsyncOpenAI

        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)

    async def generate_image(
        self,
        *,
        prompt: str,
        model: str,
        size: str,
        reference_images: tuple[ImageReference, ...] = (),
    ) -> GeneratedImage:
        if reference_images:
            response = await self._client.images.edit(
                model=model,
                prompt=prompt,
                size=size,
                n=1,
                image=_image_files(reference_images),
            )
        else:
            response = await self._client.images.generate(
                model=model,
                prompt=prompt,
                size=size,
                n=1,
            )
        return await _generated_image_from_response(response, prompt)


def _image_files(reference_images: tuple[ImageReference, ...]) -> list[ImageFile]:
    return [
        (reference.filename, reference.data, reference.mime_type)
        for reference in reference_images
    ]


async def _generated_image_from_response(response, prompt: str) -> GeneratedImage:
    items = getattr(response, "data", None) or []
    if not items:
        raise ImageProviderError("上游没有返回图片")

    image = items[0]
    revised_prompt = getattr(image, "revised_prompt", None) or prompt
    b64_json = getattr(image, "b64_json", None)
    if isinstance(b64_json, str) and b64_json:
        return GeneratedImage(
            data=_decode_b64_image(b64_json),
            mime_type=DEFAULT_MIME_TYPE,
            prompt=revised_prompt,
        )

    url = getattr(image, "url", None)
    if isinstance(url, str) and url:
        data, mime_type = await _load_image_url(url)
        return GeneratedImage(data=data, mime_type=mime_type, prompt=revised_prompt)

    raise ImageProviderError("上游图片响应缺少 b64_json 或 url")


def _decode_b64_image(value: str) -> bytes:
    payload = value
    if value.startswith("data:"):
        _, _, payload = value.partition(",")
    try:
        return base64.b64decode(payload, validate=True)
    except binascii.Error as exc:
        raise ImageProviderError("上游返回了无效的 base64 图片") from exc


async def _load_image_url(url: str) -> tuple[bytes, str]:
    return await anyio.to_thread.run_sync(_load_image_url_sync, url)


def _load_image_url_sync(url: str) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "brainstorm-imagegen"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
        content_type = response.headers.get("Content-Type", "")
    if not data:
        raise ImageProviderError("上游图片 URL 内容为空")
    mime_type = content_type.split(";", 1)[0].strip()
    if not mime_type:
        guessed, _ = mimetypes.guess_type(url)
        mime_type = guessed or DEFAULT_MIME_TYPE
    return data, mime_type
