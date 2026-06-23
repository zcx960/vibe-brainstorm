"""Real-time WebSocket connection registry and per-project broadcasting.

Each project behaves as a "room": its connected members are tracked in
``ConnectionManager.rooms`` keyed by ``project_id``. After a REST mutation
commits, the acting handler calls :meth:`ConnectionManager.broadcast` to push
the change to every *other* connected member of that project as a JSON text
frame.

The message envelope (server -> clients) is::

    {"type": <string>, "origin": <client-id string|null>, "payload": <object>}

``origin`` is the acting client's ``X-Client-Id`` (or ``None``). Broadcasts
exclude the originating client so the actor does not receive an echo of its own
mutation (it already has the optimistic local change / SSE stream).

A single module-level :data:`manager` singleton is shared by the in-process app
(routes and the WebSocket endpoint), which is exactly what the test-suite relies
on.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field

from fastapi import WebSocket


@dataclass(eq=False)
class Connection:
    """A single live WebSocket attached to a project room.

    ``eq=False`` makes instances hashable by identity so they can live in a
    ``set`` and be removed reliably even when two connections share the same
    ``client_id``.

    Beyond the socket and identifiers, a connection also carries the user's
    *presence identity* (``display_name`` and ``color``) so the room can build a
    roster and tag ephemeral presence frames (cursor/select) without a DB hit.
    """

    websocket: WebSocket
    user_id: str
    client_id: str | None = None
    display_name: str = ""
    color: str = ""


class ConnectionManager:
    """Tracks WebSocket connections per project and fans out messages.

    Not safe to share across event loops, but a FastAPI/uvicorn app (and the
    in-process Starlette ``TestClient``) runs everything on one loop, so a plain
    dict keyed by ``project_id`` is sufficient. An ``asyncio.Lock`` guards the
    room bookkeeping against interleaved connect/disconnect coroutines.
    """

    def __init__(self) -> None:
        self.rooms: dict[str, set[Connection]] = {}
        self._lock: asyncio.Lock = asyncio.Lock()

    async def connect(self, project_id: str, conn: Connection) -> None:
        """Register ``conn`` in ``project_id``'s room.

        The caller is responsible for having already ``accept()``-ed the
        WebSocket; this only records it for broadcasting.
        """
        async with self._lock:
            self.rooms.setdefault(project_id, set()).add(conn)

    async def disconnect(self, project_id: str, conn: Connection) -> None:
        """Remove ``conn`` from ``project_id``'s room (idempotent)."""
        async with self._lock:
            room = self.rooms.get(project_id)
            if room is None:
                return
            room.discard(conn)
            if not room:
                self.rooms.pop(project_id, None)

    async def broadcast(
        self,
        project_id: str,
        message: dict,
        exclude_client: str | None = None,
    ) -> None:
        """Send ``message`` (JSON-encoded once) to every connection in the room.

        Connections whose ``client_id`` equals ``exclude_client`` are skipped
        (this is how the acting client avoids receiving its own change). Any
        connection that raises while sending is treated as a dead socket and
        cleaned up.
        """
        room = self.rooms.get(project_id)
        if not room:
            return

        text = json.dumps(message, ensure_ascii=False)
        # Snapshot so concurrent connect/disconnect can't mutate during iteration.
        dead: list[Connection] = []
        for conn in list(room):
            if exclude_client is not None and conn.client_id == exclude_client:
                continue
            try:
                await conn.websocket.send_text(text)
            except Exception:  # noqa: BLE001 - dead/closing socket; drop it
                dead.append(conn)

        for conn in dead:
            await self.disconnect(project_id, conn)

    def peers(
        self, project_id: str, exclude_client: str | None = None
    ) -> list[dict]:
        """Return the presence roster for ``project_id``.

        One entry per connection currently in the room (presence is per socket,
        not per user, so two tabs of the same user appear twice). The connection
        whose ``client_id`` equals ``exclude_client`` is omitted — used to hand a
        newcomer everyone *else* who is already online.
        """
        room = self.rooms.get(project_id)
        if not room:
            return []
        return [
            {
                "clientId": conn.client_id,
                "user": {
                    "id": conn.user_id,
                    "display_name": conn.display_name,
                    "color": conn.color,
                },
            }
            for conn in room
            if conn.client_id != exclude_client
        ]

    async def send_to(self, connection: Connection, message: dict) -> None:
        """Send ``message`` (JSON text) to a single socket, swallowing errors.

        Used to hand the initial roster to just the newcomer. A dead/closing
        socket is silently ignored here; the regular disconnect path cleans it
        up from the room.
        """
        try:
            await connection.websocket.send_text(
                json.dumps(message, ensure_ascii=False)
            )
        except Exception:  # noqa: BLE001 - dead/closing socket; ignore
            pass


# Module-level singleton shared by routes and the WebSocket endpoint.
manager = ConnectionManager()
