"""Provider registry: build live providers from configuration.

Only providers whose API key is available (env var set and non-empty) get a
concrete :class:`OpenAICompatibleProvider`. Unavailable providers are simply
absent from the registry.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import Settings, get_providers, get_settings
from app.llm.openai_compatible import OpenAICompatibleProvider


def build_registry(settings: Settings | None = None) -> dict[str, OpenAICompatibleProvider]:
    """Build ``{provider_id: provider}`` for all available providers."""
    # settings is accepted for symmetry/testability; provider availability is
    # derived from the (cached) provider catalog + process environment.
    _ = settings or get_settings()
    registry: dict[str, OpenAICompatibleProvider] = {}
    for cfg in get_providers():
        if cfg.available and cfg.api_key:
            registry[cfg.id] = OpenAICompatibleProvider(
                base_url=cfg.base_url, api_key=cfg.api_key
            )
    return registry


@lru_cache
def _cached_registry() -> dict[str, OpenAICompatibleProvider]:
    return build_registry()


def get_provider(provider_id: str) -> OpenAICompatibleProvider | None:
    """Return the live provider for ``provider_id`` or None if unavailable."""
    return _cached_registry().get(provider_id)


def reset_registry_cache() -> None:
    """Clear the cached registry (useful in tests after env changes)."""
    _cached_registry.cache_clear()
