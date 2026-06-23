"""Brainstorm expansion orchestration.

``run_expansion`` is an async generator of SSE event dicts. It:
  1. loads the source node and builds the requested context;
  2. loads the brainstorm mode and renders system + user prompts;
  3. records an :class:`Expansion` row;
  4. streams ideas from the selected provider, persisting one child Node and one
     Edge per idea (laid out below/around the parent), committing as it goes;
  5. captures token usage onto the Expansion row;
  6. yields a terminal ``done`` (or ``error``) event.

Event shape (the route maps these to SSE events of the same name):
  {"event": "idea", "data": {"index": int, "node": <NodeOut dict>}}
  {"event": "done", "data": {"expansion_id", "node_ids", "edge_ids", "usage"}}
  {"event": "error", "data": {"message": str}}
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.openai_compatible import OpenAICompatibleProvider
from app.models import Edge, Expansion, Node, ProviderConfig
from app.prompts import get_mode
from app.realtime import manager
from app.schemas import EdgeOut, NodeOut
from app.services.context import build_context
from app.services.history import record_history

# Horizontal spacing between siblings and vertical drop below the parent.
_X_SPACING = 280.0
_Y_DROP = 180.0


def _parent_position(node: Node) -> tuple[float, float]:
    data = node.data or {}
    pos = data.get("position") or {}
    try:
        x = float(pos.get("x", 0.0))
    except (TypeError, ValueError):
        x = 0.0
    try:
        y = float(pos.get("y", 0.0))
    except (TypeError, ValueError):
        y = 0.0
    return x, y


def _child_position(parent: Node, index: int, count: int) -> dict[str, float]:
    px, py = _parent_position(parent)
    x = px + (index - (count - 1) / 2) * _X_SPACING
    y = py + _Y_DROP
    return {"x": x, "y": y}


def _node_out_dict(node: Node) -> dict[str, Any]:
    return NodeOut.model_validate(node).model_dump()


async def run_expansion(
    session: AsyncSession,
    *,
    project_id: str,
    node_id: str,
    mode: str,
    provider_id: str,
    model: str,
    count: int,
    instruction: str | None,
    context_strategy: str,
    client_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Run an expansion, yielding SSE-ready event dicts.

    The SSE contract to the caller is unchanged. As a side effect, each child
    node + edge is also broadcast over WebSocket to *other* connected members of
    the project (the expanding user's own client is excluded via ``client_id``,
    since they already receive the ideas through this SSE stream).
    """
    try:
        source = await session.get(Node, node_id)
        if source is None or source.project_id != project_id:
            yield {"event": "error", "data": {"message": f"节点不存在: {node_id}"}}
            return

        mode_obj = get_mode(mode)
        if mode_obj is None:
            yield {"event": "error", "data": {"message": f"未知脑爆模式: {mode}"}}
            return

        result = await session.execute(
            select(ProviderConfig).where(ProviderConfig.key == provider_id)
        )
        provider_cfg = result.scalar_one_or_none()
        if provider_cfg is None or not provider_cfg.enabled or not provider_cfg.api_key:
            yield {
                "event": "error",
                "data": {
                    "message": (
                        f"模型 '{provider_id}' 不可用：请在后台管理界面为其配置 API Key 并启用后重试。"
                    )
                },
            }
            return
        provider = OpenAICompatibleProvider(
            base_url=provider_cfg.base_url, api_key=provider_cfg.api_key
        )

        # Build context + prompts.
        context_text = await build_context(session, source, context_strategy)
        system_prompt = mode_obj.system_prompt
        user_prompt = mode_obj.expansion_template.format(
            node_title=source.title,
            node_content=source.content or "",
            context=context_text,
            count=count,
            instruction=instruction or "无",
        )

        # Record the expansion attempt.
        expansion = Expansion(
            project_id=project_id,
            source_node_id=source.id,
            mode=mode,
            provider=provider_id,
            model=model,
            instruction=instruction,
        )
        session.add(expansion)
        await session.commit()
        await session.refresh(expansion)

        # Announce the expansion id before streaming ideas.
        yield {"event": "start", "data": {"expansion_id": expansion.id}}

        node_ids: list[str] = []
        edge_ids: list[str] = []
        usage = {"prompt_tokens": 0, "completion_tokens": 0}
        index = 0
        history_recorded = False

        async for event in provider.stream_ideas(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model,
            count=count,
        ):
            etype = event.get("type")
            if etype == "idea":
                if not history_recorded:
                    await record_history(session, project_id, "brainstorm.expand")
                    history_recorded = True
                idea = event.get("idea") or {}
                title = (idea.get("title") or "").strip() or f"想法 {index + 1}"
                description = idea.get("description") or ""
                tags = idea.get("tags") or []

                child = Node(
                    project_id=project_id,
                    parent_id=source.id,
                    title=title,
                    content=description,
                    data={
                        "position": _child_position(source, index, count),
                        "tags": tags,
                    },
                )
                session.add(child)
                await session.flush()  # assign child.id

                edge = Edge(
                    project_id=project_id,
                    source_id=source.id,
                    target_id=child.id,
                    data={},
                )
                session.add(edge)
                await session.flush()  # assign edge.id
                await session.commit()
                await session.refresh(child)
                await session.refresh(edge)

                node_ids.append(child.id)
                edge_ids.append(edge.id)

                # Broadcast the new child node + edge to other connected members
                # as ordinary node.created / edge.created (no special type). The
                # expanding user's own client is excluded to avoid duplicates
                # (they get these via the SSE stream below).
                node_payload = NodeOut.model_validate(child).model_dump(mode="json")
                edge_payload = EdgeOut.model_validate(edge).model_dump(mode="json")
                await manager.broadcast(
                    project_id,
                    {
                        "type": "node.created",
                        "origin": client_id,
                        "payload": {"node": node_payload},
                    },
                    exclude_client=client_id,
                )
                await manager.broadcast(
                    project_id,
                    {
                        "type": "edge.created",
                        "origin": client_id,
                        "payload": {"edge": edge_payload},
                    },
                    exclude_client=client_id,
                )

                yield {
                    "event": "idea",
                    "data": {"index": index, "node": _node_out_dict(child)},
                }
                index += 1

            elif etype == "usage":
                u = event.get("usage") or {}
                usage = {
                    "prompt_tokens": int(u.get("prompt_tokens", 0) or 0),
                    "completion_tokens": int(u.get("completion_tokens", 0) or 0),
                }

        # Persist usage onto the expansion row.
        expansion.tokens_in = usage["prompt_tokens"]
        expansion.tokens_out = usage["completion_tokens"]
        session.add(expansion)
        await session.commit()

        yield {
            "event": "done",
            "data": {
                "expansion_id": expansion.id,
                "node_ids": node_ids,
                "edge_ids": edge_ids,
                "usage": usage,
            },
        }

    except Exception as exc:  # noqa: BLE001 - surface as an SSE error, never 500
        try:
            await session.rollback()
        except Exception:  # pragma: no cover - best effort
            pass
        yield {"event": "error", "data": {"message": str(exc)}}
