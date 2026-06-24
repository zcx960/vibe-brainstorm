from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import TypeAlias

import anyio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.image import (
    GeneratedImage,
    ImageReference,
    OpenAICompatibleImageProvider,
)
from app.models import Edge, Node, ProviderConfig
from app.services.image_events import (
    JsonValue,
    broadcast_created,
    edge_out_dict,
    node_out_dict,
)
from app.services.history import record_history
from app.services.image_layout import child_position
from app.services.image_media import store_media
from app.services.image_references import reference_images_for


@dataclass(frozen=True, slots=True)
class _ImageSuccess:
    index: int
    image: GeneratedImage


@dataclass(frozen=True, slots=True)
class _ImageFailure:
    index: int
    message: str


@dataclass(frozen=True, slots=True)
class _ImageJob:
    index: int
    prompt: str
    model: str
    size: str
    reference_images: tuple[ImageReference, ...]


@dataclass(frozen=True, slots=True)
class ImageGenerationParams:
    project_id: str
    node_id: str
    provider_id: str
    model: str
    count: int
    prompt: str | None
    size: str
    client_id: str | None = None


@dataclass(frozen=True, slots=True)
class _PersistJob:
    source: Node
    project_id: str
    index: int
    count: int
    image: GeneratedImage
    provider_id: str
    model: str
    size: str
    reference_image_urls: tuple[str, ...]


_WorkerResult: TypeAlias = _ImageSuccess | _ImageFailure


def _prompt_for(source: Node, prompt: str | None) -> str:
    cleaned = (prompt or "").strip()
    if cleaned:
        return cleaned
    content = (source.content or "").strip()
    if content:
        return f"{source.title}\n{content}"
    return source.title


async def _generate_one(
    send: anyio.abc.ObjectSendStream[_WorkerResult],
    provider: OpenAICompatibleImageProvider,
    job: _ImageJob,
) -> None:
    async with send:
        try:
            image = await provider.generate_image(
                prompt=job.prompt,
                model=job.model,
                size=job.size,
                reference_images=job.reference_images,
            )
            await send.send(_ImageSuccess(index=job.index, image=image))
        except Exception as exc:
            await send.send(_ImageFailure(index=job.index, message=str(exc)))


async def _persist_image_node(
    session: AsyncSession,
    job: _PersistJob,
) -> tuple[Node, Edge]:
    media_path, media_url = await store_media(job.project_id, job.image)
    child = Node(
        project_id=job.project_id,
        parent_id=job.source.id,
        title=f"生成图片 {job.index + 1}",
        content=job.image.prompt,
        data={
            "kind": "image",
            "position": child_position(job.source, job.index, job.count),
            "image_url": media_url,
            "media_path": media_path,
            "prompt": job.image.prompt,
            "provider": job.provider_id,
            "model": job.model,
            "size": job.size,
            "reference_image_urls": list(job.reference_image_urls),
        },
    )
    session.add(child)
    await session.flush()

    edge = Edge(
        project_id=job.project_id,
        source_id=job.source.id,
        target_id=child.id,
        data={"kind": "image"},
    )
    session.add(edge)
    await session.flush()
    await session.commit()
    await session.refresh(child)
    await session.refresh(edge)
    return child, edge


async def run_image_generation(
    session: AsyncSession,
    params: ImageGenerationParams,
) -> AsyncIterator[dict[str, JsonValue]]:
    source = await session.get(Node, params.node_id)
    if source is None or source.project_id != params.project_id:
        yield {"event": "error", "data": {"message": f"节点不存在: {params.node_id}"}}
        return

    result = await session.execute(
        select(ProviderConfig).where(ProviderConfig.key == params.provider_id)
    )
    provider_cfg = result.scalar_one_or_none()
    if (
        provider_cfg is None
        or not provider_cfg.enabled
        or not provider_cfg.api_key
        or params.model not in list(provider_cfg.image_models or [])
    ):
        yield {
            "event": "error",
            "data": {
                "message": (
                    f"生图模型 '{params.provider_id}/{params.model}' 不可用：请在后台管理界面配置生图模型和 API Key。"
                )
            },
        }
        return

    provider = OpenAICompatibleImageProvider(
        base_url=provider_cfg.base_url,
        api_key=provider_cfg.api_key,
    )
    effective_prompt = _prompt_for(source, params.prompt)
    references = await reference_images_for(session, source)
    node_ids: list[str] = []
    edge_ids: list[str] = []
    failed = 0
    history_recorded = False

    yield {
        "event": "start",
        "data": {"count": params.count, "reference_count": len(references.images)},
    }

    send, receive = anyio.create_memory_object_stream[_WorkerResult](params.count)
    async with anyio.create_task_group() as task_group:
        for index in range(params.count):
            task_group.start_soon(
                _generate_one,
                send.clone(),
                provider,
                _ImageJob(
                    index=index,
                    prompt=effective_prompt,
                    model=params.model,
                    size=params.size,
                    reference_images=references.images,
                ),
            )
        await send.aclose()
        async with receive:
            async for item in receive:
                match item:
                    case _ImageSuccess(index=index, image=image):
                        if not history_recorded:
                            await record_history(
                                session, params.project_id, "image.generate"
                            )
                            history_recorded = True
                        node, edge = await _persist_image_node(
                            session,
                            _PersistJob(
                                source=source,
                                project_id=params.project_id,
                                index=index,
                                count=params.count,
                                image=image,
                                provider_id=params.provider_id,
                                model=params.model,
                                size=params.size,
                                reference_image_urls=references.urls,
                            ),
                        )
                        node_ids.append(node.id)
                        edge_ids.append(edge.id)
                        await broadcast_created(
                            params.project_id,
                            node=node,
                            edge=edge,
                            client_id=params.client_id,
                        )
                        yield {
                            "event": "image",
                            "data": {
                                "index": index,
                                "node": node_out_dict(node),
                                "edge": edge_out_dict(edge),
                            },
                        }
                    case _ImageFailure(index=index, message=message):
                        failed += 1
                        yield {
                            "event": "image_error",
                            "data": {"index": index, "message": message},
                        }

    yield {
        "event": "done",
        "data": {
            "node_ids": node_ids,
            "edge_ids": edge_ids,
            "count_ok": len(node_ids),
            "count_failed": failed,
        },
    }
