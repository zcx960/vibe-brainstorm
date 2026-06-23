"""End-to-end real-time WebSocket broadcasting tests (offline, aiosqlite).

These mirror ``conftest.py``'s in-memory-aiosqlite setup but build the engine
locally so the WebSocket auth path (which opens its OWN session via
``app.db.SessionLocal`` rather than ``Depends(get_session)``) can be pointed at
the same test database. The in-process app shares the ``manager`` singleton, so
REST mutations made through the TestClient fan out to live ``websocket_connect``
sockets in the same process.

Covered:
  - A member's WS receives ``node.created`` with ``origin`` = actor's client id.
  - The acting client is excluded from its own broadcast (no echo).
  - Bad-token connection is rejected (close), and a non-member is rejected.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from starlette.websockets import WebSocketDisconnect

from app import db as db_module
from app.db import Base, get_session
from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    """TestClient on a shared in-memory aiosqlite DB.

    Overrides both the ``get_session`` dependency (for REST routes) and
    ``app.db.SessionLocal`` (for the WS endpoint's self-managed session) so all
    DB access lands on the one test engine.
    """
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

    # The WS endpoint opens its own session via db_module.SessionLocal; point it
    # at the test engine for the duration of the test.
    original_sessionlocal = db_module.SessionLocal
    db_module.SessionLocal = maker

    test_client = TestClient(app)
    try:
        yield test_client
    finally:
        test_client.close()

    app.dependency_overrides.pop(get_session, None)
    db_module.SessionLocal = original_sessionlocal

    async def _dispose() -> None:
        await engine.dispose()

    asyncio.run(_dispose())


def _register(client: TestClient, username: str) -> tuple[str, str]:
    resp = client.post(
        "/api/auth/register", json={"username": username, "password": "pw123456"}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["token"], body["user"]["id"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_shared_project(client: TestClient) -> tuple[str, str, str]:
    """A creates a project; B joins via share link. Returns (pid, tokenA, tokenB)."""
    a_token, _ = _register(client, "rt_owner@example.com")
    b_token, _ = _register(client, "rt_guest@example.com")

    resp = client.post("/api/projects", json={"name": "RT"}, headers=_auth(a_token))
    assert resp.status_code == 201, resp.text
    pid = resp.json()["id"]

    resp = client.post(f"/api/projects/{pid}/share", headers=_auth(a_token))
    assert resp.status_code == 200, resp.text
    token_value = resp.json()["token"]

    resp = client.post(f"/api/share/{token_value}/accept", headers=_auth(b_token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "editor"

    return pid, a_token, b_token


def test_node_created_broadcasts_to_other_member(client: TestClient) -> None:
    pid, a_token, b_token = _make_shared_project(client)

    with client.websocket_connect(
        f"/api/ws/projects/{pid}?token={b_token}&clientId=clientB"
    ) as ws_b:
        # On connect, the room hands B its presence roster first; drain it so
        # the next frame asserted on is the graph broadcast.
        assert ws_b.receive_json()["type"] == "presence.state"

        # A creates a node tagged with its client id.
        resp = client.post(
            f"/api/projects/{pid}/nodes",
            json={"title": "From A"},
            headers={**_auth(a_token), "X-Client-Id": "clientA"},
        )
        assert resp.status_code == 201, resp.text
        created = resp.json()

        frame = ws_b.receive_json()
        assert frame["type"] == "node.created"
        assert frame["origin"] == "clientA"
        assert frame["payload"]["node"]["id"] == created["id"]
        assert frame["payload"]["node"]["title"] == "From A"


def test_actor_client_is_excluded_from_own_broadcast(client: TestClient) -> None:
    pid, a_token, b_token = _make_shared_project(client)

    with client.websocket_connect(
        f"/api/ws/projects/{pid}?token={b_token}&clientId=clientB"
    ) as ws_b:
        # B connects first -> presence.state with an empty roster.
        assert ws_b.receive_json()["type"] == "presence.state"

        with client.websocket_connect(
            f"/api/ws/projects/{pid}?token={a_token}&clientId=clientA"
        ) as ws_a:
            # A connecting hands A its roster and tells B that A joined; drain
            # both so the only thing left to assert is the graph broadcast.
            assert ws_a.receive_json()["type"] == "presence.state"
            assert ws_b.receive_json()["type"] == "presence.join"

            # A creates a node as clientA: B should get it, A should NOT.
            resp = client.post(
                f"/api/projects/{pid}/nodes",
                json={"title": "Exclusion test"},
                headers={**_auth(a_token), "X-Client-Id": "clientA"},
            )
            assert resp.status_code == 201, resp.text
            node_id = resp.json()["id"]

            # B receives the frame.
            frame_b = ws_b.receive_json()
            assert frame_b["type"] == "node.created"
            assert frame_b["origin"] == "clientA"
            assert frame_b["payload"]["node"]["id"] == node_id

            # A must NOT receive its own change. Prove it by sending a ping and
            # asserting the next frame A sees is the pong, not a node.created.
            ws_a.send_json({"type": "ping"})
            next_for_a = ws_a.receive_json()
            assert next_for_a == {"type": "pong"}


def test_ws_rejects_bad_token(client: TestClient) -> None:
    pid, _a_token, _b_token = _make_shared_project(client)

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            f"/api/ws/projects/{pid}?token=not-a-real-token&clientId=clientX"
        ) as ws:
            # Server closes with 4401 before/at accept; the first receive raises.
            ws.receive_text()


def test_ws_rejects_non_member(client: TestClient) -> None:
    pid, _a_token, _b_token = _make_shared_project(client)
    # Register a third user who never joined the project.
    c_token, _ = _register(client, "rt_outsider@example.com")

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            f"/api/ws/projects/{pid}?token={c_token}&clientId=clientC"
        ) as ws:
            ws.receive_text()
