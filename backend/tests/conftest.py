"""Shared pytest fixtures for end-to-end API tests.

Spins up the real FastAPI app against an in-memory aiosqlite database (single
shared connection via StaticPool) and overrides the ``get_session`` dependency
so routes use the test engine. No Postgres and no network are required.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)

    async def _create() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_create())

    async def _override_get_session() -> AsyncIterator:
        async with maker() as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session

    # Construct the TestClient WITHOUT the `with` block so the app lifespan does
    # NOT run (it would call create_all + _seed_admin against the production
    # Postgres engine). Tables are created against the test engine above and the
    # get_session override routes all DB access there.
    test_client = TestClient(app)
    try:
        yield test_client
    finally:
        test_client.close()

    app.dependency_overrides.pop(get_session, None)

    async def _dispose() -> None:
        await engine.dispose()

    asyncio.run(_dispose())
