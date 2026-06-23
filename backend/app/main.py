"""FastAPI application entrypoint.

On startup: create all tables (``create_all`` via run_sync) and, if the provider
table is empty, seed it from ``providers.yaml`` (resolving keys from the env).
Wires CORS and all routers under ``/api``.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text

from app.api import (
    routes_admin,
    routes_auth,
    routes_brainstorm,
    routes_config,
    routes_graph,
    routes_images,
    routes_projects,
    routes_share,
    routes_ws,
)
from app.config import get_providers, get_settings
from app.db import SessionLocal, create_all, engine
from app.models import ProviderConfig

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:8080",
    "*",
]


async def _seed_providers() -> None:
    """Seed the provider catalog from providers.yaml if the table is empty.

    YAML is only a seed source now: at runtime providers live in the DB and are
    managed via the admin panel. API keys are resolved from the environment
    (the ``api_key_env`` named in each YAML entry) and stored on the row.
    """
    async with SessionLocal() as session:
        count = await session.scalar(select(func.count()).select_from(ProviderConfig))
        if count and count > 0:
            return
        for cfg in get_providers():
            session.add(
                ProviderConfig(
                    key=cfg.id,
                    name=cfg.name,
                    base_url=cfg.base_url,
                    api_key=cfg.api_key,  # resolved from env (or None)
                    models=list(cfg.models),
                    image_models=list(cfg.image_models),
                    enabled=True,
                )
            )
        await session.commit()


async def _ensure_columns() -> None:
    async with engine.begin() as conn:
        columns = await conn.run_sync(
            lambda sync_conn: [
                col["name"]
                for col in sa_inspect(sync_conn).get_columns("provider_configs")
            ]
        )
        if "image_models" in columns:
            return
        if conn.dialect.name == "postgresql":
            await conn.execute(
                text(
                    "ALTER TABLE provider_configs "
                    "ADD COLUMN IF NOT EXISTS image_models JSONB NOT NULL DEFAULT '[]'::jsonb"
                )
            )
            return
        await conn.execute(
            text(
                "ALTER TABLE provider_configs "
                "ADD COLUMN image_models JSON NOT NULL DEFAULT '[]'"
            )
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await create_all()
    await _ensure_columns()
    await _seed_providers()
    yield
    # Shutdown (nothing to clean up explicitly; engine disposes on exit).


app = FastAPI(title="Brainstorm Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(routes_auth.router, prefix="/api")
app.include_router(routes_admin.router, prefix="/api")
app.include_router(routes_config.router, prefix="/api")
app.include_router(routes_projects.router, prefix="/api")
app.include_router(routes_share.router, prefix="/api")
app.include_router(routes_graph.router, prefix="/api")
app.include_router(routes_brainstorm.router, prefix="/api")
app.include_router(routes_images.router, prefix="/api")
app.include_router(routes_ws.router, prefix="/api")

_media_dir = Path(get_settings().media_dir)
_media_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/media", StaticFiles(directory=str(_media_dir)), name="media")
