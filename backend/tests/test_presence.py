"""Presence relay tests (online roster + live cursor + selection).

Presence is ephemeral: it is relayed over the existing per-project WebSocket
room and never persisted. These tests reuse the same offline in-memory-aiosqlite
setup as ``test_realtime.py`` (a locally-built engine repointed at both the
``get_session`` dependency and ``app.db.SessionLocal``, which the WS endpoint
opens itself) so the in-process ``manager`` singleton fans presence frames out
to live ``websocket_connect`` sockets in the same process.

Presence rides the same envelope as graph broadcasts::

    {"type": <string>, "origin": <client-id|null>, "payload": <object>}

``origin`` is always the *sender's* client id, and presence is only sent to
OTHER clients, so a client never sees an echo of its own presence.

Covered:
  - On a second member joining, the first member receives ``presence.join``
    (origin = newcomer) and the newcomer receives ``presence.state`` whose
    ``payload.peers`` includes the already-online member.
  - A ``presence.cursor`` frame from A is relayed to B with origin = A and the
    coordinates + sender's user info echoed.
  - When A's socket closes, B receives ``presence.leave`` with origin = A.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app import db as db_module
from app.db import Base, get_session
from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    """TestClient on a shared in-memory aiosqlite DB.

    Overrides both the ``get_session`` dependency (REST routes) and
    ``app.db.SessionLocal`` (the WS endpoint's self-managed session) so all DB
    access lands on the one test engine.
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


def _make_shared_project(client: TestClient) -> tuple[str, str, str, str, str]:
    """A creates a project; B joins via share link.

    Returns ``(pid, tokenA, tokenB, idA, idB)``.
    """
    a_token, a_id = _register(client, "pres_owner")
    b_token, b_id = _register(client, "pres_guest")

    resp = client.post("/api/projects", json={"name": "Pres"}, headers=_auth(a_token))
    assert resp.status_code == 201, resp.text
    pid = resp.json()["id"]

    resp = client.post(f"/api/projects/{pid}/share", headers=_auth(a_token))
    assert resp.status_code == 200, resp.text
    token_value = resp.json()["token"]

    resp = client.post(f"/api/share/{token_value}/accept", headers=_auth(b_token))
    assert resp.status_code == 200, resp.text

    return pid, a_token, b_token, a_id, b_id


def test_join_relays_state_to_newcomer_and_join_to_existing(
    client: TestClient,
) -> None:
    pid, a_token, b_token, a_id, b_id = _make_shared_project(client)

    # A connects first; A's own presence.state (empty room) is drained.
    with client.websocket_connect(
        f"/api/ws/projects/{pid}?token={a_token}&clientId=clientA"
    ) as ws_a:
        state_a = ws_a.receive_json()
        assert state_a["type"] == "presence.state"
        assert state_a["origin"] is None
        assert state_a["payload"]["peers"] == []

        # B joins second. B should receive presence.state listing A; A should
        # receive presence.join announcing B.
        with client.websocket_connect(
            f"/api/ws/projects/{pid}?token={b_token}&clientId=clientB"
        ) as ws_b:
            state_b = ws_b.receive_json()
            assert state_b["type"] == "presence.state"
            assert state_b["origin"] is None
            peers = state_b["payload"]["peers"]
            assert len(peers) == 1
            assert peers[0]["clientId"] == "clientA"
            assert peers[0]["user"]["id"] == a_id

            join_a = ws_a.receive_json()
            assert join_a["type"] == "presence.join"
            assert join_a["origin"] == "clientB"
            assert join_a["payload"]["user"]["id"] == b_id


def test_cursor_relays_to_other_member(client: TestClient) -> None:
    pid, a_token, b_token, a_id, _b_id = _make_shared_project(client)

    with client.websocket_connect(
        f"/api/ws/projects/{pid}?token={a_token}&clientId=clientA"
    ) as ws_a:
        ws_a.receive_json()  # drain A's presence.state

        with client.websocket_connect(
            f"/api/ws/projects/{pid}?token={b_token}&clientId=clientB"
        ) as ws_b:
            ws_b.receive_json()  # drain B's presence.state
            ws_a.receive_json()  # drain A's presence.join for B

            # A moves its cursor; B should receive it tagged with A's identity.
            ws_a.send_json({"type": "presence.cursor", "x": 12, "y": 34})

            frame = ws_b.receive_json()
            assert frame["type"] == "presence.cursor"
            assert frame["origin"] == "clientA"
            assert frame["payload"]["x"] == 12
            assert frame["payload"]["y"] == 34
            assert frame["payload"]["user"]["id"] == a_id
            assert frame["payload"]["user"]["display_name"] == "pres_owner"


def test_select_relays_to_other_member(client: TestClient) -> None:
    pid, a_token, b_token, a_id, _b_id = _make_shared_project(client)

    with client.websocket_connect(
        f"/api/ws/projects/{pid}?token={a_token}&clientId=clientA"
    ) as ws_a:
        ws_a.receive_json()  # drain A's presence.state

        with client.websocket_connect(
            f"/api/ws/projects/{pid}?token={b_token}&clientId=clientB"
        ) as ws_b:
            ws_b.receive_json()  # drain B's presence.state
            ws_a.receive_json()  # drain A's presence.join for B

            ws_a.send_json({"type": "presence.select", "nodeId": "node-xyz"})

            frame = ws_b.receive_json()
            assert frame["type"] == "presence.select"
            assert frame["origin"] == "clientA"
            assert frame["payload"]["nodeId"] == "node-xyz"
            assert frame["payload"]["user"]["id"] == a_id


def test_leave_broadcasts_on_disconnect(client: TestClient) -> None:
    pid, a_token, b_token, a_id, _b_id = _make_shared_project(client)

    with client.websocket_connect(
        f"/api/ws/projects/{pid}?token={b_token}&clientId=clientB"
    ) as ws_b:
        ws_b.receive_json()  # drain B's presence.state (empty room)

        # A joins then leaves; B should observe the join then the leave.
        with client.websocket_connect(
            f"/api/ws/projects/{pid}?token={a_token}&clientId=clientA"
        ) as ws_a:
            ws_a.receive_json()  # drain A's presence.state listing B
            join = ws_b.receive_json()
            assert join["type"] == "presence.join"
            assert join["origin"] == "clientA"

        # On exiting the context, A's socket closes -> B gets presence.leave.
        leave = ws_b.receive_json()
        assert leave["type"] == "presence.leave"
        assert leave["origin"] == "clientA"
        assert leave["payload"] == {}
