"""LLM provider abstraction.

A provider knows how to stream brainstorm ideas from an OpenAI-compatible chat
completions endpoint. Concrete implementations live alongside this module.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any

# JSON schema describing the structured response we ask the model to produce.
# Used with response_format={"type": "json_schema", ...} where supported.
IDEAS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ideas": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["title", "description", "tags"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["ideas"],
    "additionalProperties": False,
}


class LLMProvider(ABC):
    """Abstract base for streaming-idea providers."""

    @abstractmethod
    def stream_ideas(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: str,
        count: int,
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream brainstorm ideas as event dicts.

        Yields, in order:
          - zero or more ``{"type": "idea", "idea": {"title","description","tags"}}``
            events, one per generated idea, as soon as each is parsed;
          - a final ``{"type": "usage", "usage": {"prompt_tokens": int,
            "completion_tokens": int}}`` event.

        Implementations must be robust to providers that do not support strict
        JSON schema response formats.
        """
        raise NotImplementedError
