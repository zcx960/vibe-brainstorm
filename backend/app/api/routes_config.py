"""Config endpoints: providers, modes, defaults.

Providers are sourced from the database (managed via the admin panel). API keys
are NEVER serialized to clients — only an ``available`` flag is exposed.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import ProviderConfig
from app.prompts import list_modes
from app.schemas import DefaultsOut, ModesOut, ProviderOut, ProvidersOut

router = APIRouter(prefix="/config", tags=["config"])


async def _available_providers(session: AsyncSession) -> list[ProviderConfig]:
    """Enabled providers ordered by name (newest config wins ties by key)."""
    result = await session.execute(
        select(ProviderConfig).where(ProviderConfig.enabled.is_(True)).order_by(ProviderConfig.name)
    )
    return list(result.scalars().all())


@router.get("/providers", response_model=ProvidersOut)
async def get_providers_endpoint(
    session: AsyncSession = Depends(get_session),
) -> ProvidersOut:
    """List enabled providers (id=key, name, models, available). No keys."""
    providers = [
        ProviderOut(
            id=p.key,
            name=p.name,
            models=list(p.models or []),
            image_models=list(p.image_models or []),
            available=bool(p.api_key),
        )
        for p in await _available_providers(session)
    ]
    return ProvidersOut(providers=providers)


@router.get("/modes", response_model=ModesOut)
async def get_modes_endpoint() -> ModesOut:
    """List available brainstorm modes (id, name, description)."""
    return ModesOut(modes=[m.public_dict() for m in list_modes()])


@router.get("/defaults", response_model=DefaultsOut)
async def get_defaults_endpoint(
    session: AsyncSession = Depends(get_session),
) -> DefaultsOut:
    """Default provider + model for new expansions.

    Prefers the env-configured default when it's an enabled+available provider;
    otherwise falls back to the first available provider and its first model.
    """
    settings = get_settings()
    providers = await _available_providers(session)
    available = [p for p in providers if p.api_key]

    chosen = next((p for p in available if p.key == settings.default_provider), None)
    if chosen is not None:
        model = (
            settings.default_model
            if settings.default_model in (chosen.models or [])
            else (chosen.models[0] if chosen.models else settings.default_model)
        )
        return DefaultsOut(provider=chosen.key, model=model)

    if available:
        first = available[0]
        return DefaultsOut(
            provider=first.key,
            model=first.models[0] if first.models else "",
        )

    return DefaultsOut(provider="", model="")
