"""Async database engine, session maker, and declarative base.

Uses SQLAlchemy 2.0 async. The production database is PostgreSQL (asyncpg),
while the test-suite uses an in-memory aiosqlite database. All models use
portable column types so the same models work on both backends.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def _make_engine() -> AsyncEngine:
    settings = get_settings()
    # echo can be toggled via settings if needed; keep quiet by default.
    return create_async_engine(settings.database_url, future=True, echo=False)


# Module-level engine + session factory. Created lazily on import so the app
# (and tests, which override the engine) can share the same Base metadata.
engine: AsyncEngine = _make_engine()
SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine, expire_on_commit=False, class_=AsyncSession
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped async session."""
    async with SessionLocal() as session:
        yield session


async def create_all() -> None:
    """Create all tables via run_sync against the async engine."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
