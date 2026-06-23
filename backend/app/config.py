"""Application configuration.

Loads runtime settings from environment variables (via pydantic-settings) and
the provider catalog from ``providers.yaml``. API keys are resolved from the
process environment at request time and are NEVER serialized to clients.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> backend/  (parent of the app package)
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_PROVIDERS_FILE = _BACKEND_DIR / "providers.yaml"


class Settings(BaseSettings):
    """Runtime settings sourced from environment variables."""

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    database_url: str = "postgresql+asyncpg://brainstorm:brainstorm@localhost:5432/brainstorm"
    default_provider: str = "deepseek"
    default_model: str = "deepseek-chat"
    providers_file: str = str(_DEFAULT_PROVIDERS_FILE)

    # Auth / JWT (read from env JWT_SECRET, JWT_EXPIRE_DAYS, ADMIN_PASSWORD).
    jwt_secret: str = "dev-insecure-secret"
    jwt_expire_days: int = 7
    # Single shared password for the /admin panel (NOT a user account).
    admin_password: str = "admin123"
    # Directory where generated images are stored and served from (/api/media).
    media_dir: str = "./media"


@dataclass
class ProviderConfig:
    """A single provider entry loaded from providers.yaml."""

    id: str
    name: str
    base_url: str
    api_key_env: str
    models: list[str] = field(default_factory=list)
    image_models: list[str] = field(default_factory=list)

    @property
    def api_key(self) -> str | None:
        """Resolve the API key from the environment (or None if unset/empty)."""
        value = os.environ.get(self.api_key_env, "")
        return value or None

    @property
    def available(self) -> bool:
        """A provider is available iff its API key env var is set and non-empty."""
        return self.api_key is not None

    def public_dict(self) -> dict:
        """Serialize for the API WITHOUT leaking the key."""
        return {
            "id": self.id,
            "name": self.name,
            "models": list(self.models),
            "image_models": list(self.image_models),
            "available": self.available,
        }


def load_providers(providers_file: str | os.PathLike[str]) -> list[ProviderConfig]:
    """Parse providers.yaml into a list of ProviderConfig.

    Returns an empty list if the file is missing or empty so the app can still
    boot (the providers endpoint will simply report nothing available).
    """
    path = Path(providers_file)
    if not path.exists():
        return []

    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    entries = raw.get("providers", []) or []

    providers: list[ProviderConfig] = []
    for entry in entries:
        providers.append(
            ProviderConfig(
                id=entry["id"],
                name=entry.get("name", entry["id"]),
                base_url=entry["base_url"],
                api_key_env=entry["api_key_env"],
                models=list(entry.get("models", []) or []),
                image_models=list(entry.get("image_models", []) or []),
            )
        )
    return providers


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()


@lru_cache
def get_providers() -> list[ProviderConfig]:
    """Cached provider catalog loaded from the configured providers file."""
    settings = get_settings()
    return load_providers(settings.providers_file)


def list_public_providers() -> list[dict]:
    """Provider list for the API: id, name, models, available (no keys)."""
    return [p.public_dict() for p in get_providers()]


def get_provider_config(provider_id: str) -> ProviderConfig | None:
    """Look up a provider config by id."""
    for p in get_providers():
        if p.id == provider_id:
            return p
    return None
