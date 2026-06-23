"""OpenAI-compatible streaming provider.

Talks to any OpenAI-compatible ``/chat/completions`` endpoint via the official
``openai`` SDK with a ``base_url`` override. Streams deltas through the
incremental :class:`IdeaStreamParser` so ideas surface as soon as they parse.

Robustness: not every provider accepts ``response_format`` of type
``json_schema`` (or ``strict``). We try, in order:
  1. ``{"type": "json_schema", "json_schema": {... strict: True}}``
  2. ``{"type": "json_object"}``  (with a strengthened instruction)
  3. no ``response_format`` at all (plain text, parsed leniently)
falling through on ``BadRequestError`` or any error mentioning the response
format / json schema.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from openai import AsyncOpenAI

from app.llm.base import IDEAS_SCHEMA, LLMProvider
from app.llm.json_stream import IdeaStreamParser

# Appended to the user prompt when we fall back to json_object / plain modes,
# since those modes don't enforce the schema for us.
_JSON_OBJECT_HINT = (
    '\n\n请严格只输出一个 JSON 对象，形如：'
    '{"ideas":[{"title":"...","description":"...","tags":["...","..."]}]}。'
    "不要输出除该 JSON 以外的任何文字、解释或 markdown 代码块标记。"
)


def _is_response_format_error(exc: Exception) -> bool:
    """Heuristic: did this error come from an unsupported response_format?"""
    text = f"{type(exc).__name__}: {exc}".lower()
    needles = ("response_format", "json_schema", "json schema", "strict", "schema")
    return any(n in text for n in needles)


class OpenAICompatibleProvider(LLMProvider):
    def __init__(self, base_url: str, api_key: str) -> None:
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)

    async def stream_ideas(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: str,
        count: int,
    ) -> AsyncIterator[dict[str, Any]]:
        # Build the response_format fallback chain.
        json_schema_fmt = {
            "type": "json_schema",
            "json_schema": {
                "name": "ideas",
                "schema": IDEAS_SCHEMA,
                "strict": True,
            },
        }
        attempts: list[tuple[dict[str, Any] | None, str]] = [
            (json_schema_fmt, user_prompt),
            ({"type": "json_object"}, user_prompt + _JSON_OBJECT_HINT),
            (None, user_prompt + _JSON_OBJECT_HINT),
        ]

        last_exc: Exception | None = None
        for index, (response_format, effective_user_prompt) in enumerate(attempts):
            try:
                async for event in self._stream_once(
                    system_prompt=system_prompt,
                    user_prompt=effective_user_prompt,
                    model=model,
                    count=count,
                    response_format=response_format,
                ):
                    yield event
                return  # success
            except Exception as exc:  # noqa: BLE001 - resilience is the point
                last_exc = exc
                is_last = index == len(attempts) - 1
                # Only fall through to the next mode for response_format-shaped
                # errors. For other errors on a non-last attempt, still try a
                # simpler mode (best-effort); on the last attempt, re-raise.
                if is_last:
                    raise
                if not _is_response_format_error(exc):
                    # Non-format error: try once more in a simpler mode, but if
                    # the simpler mode also fails the loop will re-raise.
                    continue

        if last_exc is not None:  # pragma: no cover - defensive
            raise last_exc

    async def _stream_once(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: str,
        count: int,
        response_format: dict[str, Any] | None,
    ) -> AsyncIterator[dict[str, Any]]:
        parser = IdeaStreamParser()
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
            # Ask the provider to include usage in the final stream chunk where
            # supported (OpenAI-compatible streaming usage option).
            "stream_options": {"include_usage": True},
        }
        if response_format is not None:
            kwargs["response_format"] = response_format

        prompt_tokens = 0
        completion_tokens = 0
        emitted = 0

        try:
            stream = await self._client.chat.completions.create(**kwargs)
        except TypeError:
            # Some older/edge clients reject stream_options; retry without it.
            kwargs.pop("stream_options", None)
            stream = await self._client.chat.completions.create(**kwargs)

        async for chunk in stream:
            # Usage may appear on the final chunk (choices empty).
            usage = getattr(chunk, "usage", None)
            if usage is not None:
                prompt_tokens = getattr(usage, "prompt_tokens", prompt_tokens) or prompt_tokens
                completion_tokens = (
                    getattr(usage, "completion_tokens", completion_tokens) or completion_tokens
                )

            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            delta = getattr(choices[0], "delta", None)
            piece = getattr(delta, "content", None) if delta is not None else None
            if not piece:
                continue

            for idea in parser.feed(piece):
                emitted += 1
                yield {"type": "idea", "idea": idea}

        # Final fallback: parse anything the incremental scanner missed.
        for idea in parser.finalize():
            emitted += 1
            yield {"type": "idea", "idea": idea}

        yield {
            "type": "usage",
            "usage": {
                "prompt_tokens": int(prompt_tokens or 0),
                "completion_tokens": int(completion_tokens or 0),
            },
        }
