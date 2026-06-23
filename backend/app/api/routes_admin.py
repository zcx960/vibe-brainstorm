"""Admin endpoints: password login + LLM provider management.

The admin panel is gated by a single shared password (``ADMIN_PASSWORD``, default
``admin123``) — it is NOT a user account. All routes except ``/admin/login``
require a valid admin token (``Authorization: Bearer <token>``).

Provider rows store an ``api_key`` server-side; it is NEVER returned to clients.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_admin_token, require_admin
from app.config import get_settings
from app.db import get_session
from app.models import ProviderConfig
from app.schemas import (
    AdminLoginIn,
    AdminProviderCreate,
    AdminProviderOut,
    AdminProvidersOut,
    AdminProviderUpdate,
    AdminTokenOut,
)

router = APIRouter(prefix="/admin", tags=["admin"])


def _to_out(p: ProviderConfig) -> AdminProviderOut:
    return AdminProviderOut(
        id=p.id,
        key=p.key,
        name=p.name,
        base_url=p.base_url,
        models=list(p.models or []),
        image_models=list(p.image_models or []),
        enabled=p.enabled,
        has_key=bool(p.api_key),
    )


@router.post("/login", response_model=AdminTokenOut)
async def admin_login(body: AdminLoginIn) -> AdminTokenOut:
    settings = get_settings()
    if not settings.admin_password or body.password != settings.admin_password:
        raise HTTPException(status_code=401, detail="Wrong admin password")
    return AdminTokenOut(token=create_admin_token())


@router.get("/providers", response_model=AdminProvidersOut)
async def list_providers(
    _: bool = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> AdminProvidersOut:
    result = await session.execute(select(ProviderConfig).order_by(ProviderConfig.name))
    return AdminProvidersOut(providers=[_to_out(p) for p in result.scalars().all()])


@router.post(
    "/providers", response_model=AdminProviderOut, status_code=status.HTTP_201_CREATED
)
async def create_provider(
    body: AdminProviderCreate,
    _: bool = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> AdminProviderOut:
    key = body.key.strip()
    if not key:
        raise HTTPException(status_code=422, detail="key is required")
    existing = await session.execute(
        select(ProviderConfig).where(ProviderConfig.key == key)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Provider key already exists")

    provider = ProviderConfig(
        key=key,
        name=body.name.strip() or key,
        base_url=body.base_url.strip(),
        api_key=(body.api_key or None) or None,
        models=list(body.models or []),
        image_models=list(body.image_models or []),
        enabled=body.enabled,
    )
    session.add(provider)
    await session.commit()
    await session.refresh(provider)
    return _to_out(provider)


@router.patch("/providers/{provider_id}", response_model=AdminProviderOut)
async def update_provider(
    provider_id: str,
    body: AdminProviderUpdate,
    _: bool = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> AdminProviderOut:
    provider = await session.get(ProviderConfig, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")

    if body.name is not None:
        provider.name = body.name.strip() or provider.name
    if body.base_url is not None:
        provider.base_url = body.base_url.strip()
    if body.models is not None:
        provider.models = list(body.models)
    if body.image_models is not None:
        provider.image_models = list(body.image_models)
    if body.enabled is not None:
        provider.enabled = body.enabled
    # Only overwrite the key when a non-empty value is supplied.
    if body.api_key is not None and body.api_key.strip():
        provider.api_key = body.api_key.strip()

    await session.commit()
    await session.refresh(provider)
    return _to_out(provider)


@router.delete("/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: str,
    _: bool = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    provider = await session.get(ProviderConfig, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    await session.delete(provider)
    await session.commit()
