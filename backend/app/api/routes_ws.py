"""WebSocket endpoint for per-project real-time rooms.

The router carries no prefix; ``main.py`` mounts it under ``/api`` so the full
path is ``/api/ws/projects/{project_id}``.

Auth is done from query params (``token`` + ``clientId``) rather than headers,
because browser ``WebSocket`` clients cannot set ``Authorization``. A dedicated
``SessionLocal()`` is opened for the auth/role check (NOT ``Depends(get_session)``
— dependency-injected request sessions are awkward to reason about across the
long-lived socket lifetime).

Phase 3 layers *presence relay* over the same room: who is online (roster),
where their cursor is, and which node they have selected. Presence is ephemeral
(never persisted) and rides the SAME envelope as graph broadcasts so the
existing frontend parser handles it uniformly::

    {"type": <string>, "origin": <client-id|null>, "payload": <object>}

``origin`` is always the *sender's* client id, and presence is only ever sent to
OTHER clients, so a client never receives an echo of its own presence. Inbound
frames the server understands:

  - ``{"type": "presence.cursor", "x": <num>, "y": <num>}``
  - ``{"type": "presence.select", "nodeId": <id|null>}``
  - ``{"type": "ping"}`` -> answered with ``{"type": "pong"}``

anything else (including malformed JSON) is ignored without crashing the loop.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import db as db_module
from app.auth import get_user_from_token
from app.permissions import get_role
from app.realtime import Connection, manager

router = APIRouter(tags=["ws"])


@router.websocket("/ws/projects/{project_id}")
async def project_ws(websocket: WebSocket, project_id: str) -> None:
    token = websocket.query_params.get("token")
    client_id = websocket.query_params.get("clientId")

    # Authenticate + authorize BEFORE accepting the handshake. Open our own
    # session (not Depends(get_session)) for the long-lived socket. Referenced
    # through the module so the test-suite can point it at the test engine.
    async with db_module.SessionLocal() as session:
        user = await get_user_from_token(session, token)
        if user is None:
            await websocket.close(code=4401)
            return
        role = await get_role(session, project_id, user.id)
        if role is None:
            await websocket.close(code=4403)
            return
        # Snapshot the presence identity while the session/user is still live.
        user_id = user.id
        display_name = user.display_name
        color = user.color

    # The presence identity broadcast for cursor/select frames and join/leave.
    presence_user = {
        "id": user_id,
        "display_name": display_name,
        "color": color,
    }

    await websocket.accept()
    conn = Connection(
        websocket=websocket,
        user_id=user_id,
        client_id=client_id,
        display_name=display_name,
        color=color,
    )
    await manager.connect(project_id, conn)

    # Presence join: hand the newcomer the current roster (everyone *else*
    # already online), then announce the newcomer to the rest of the room.
    await manager.send_to(
        conn,
        {
            "type": "presence.state",
            "origin": None,
            "payload": {
                "peers": manager.peers(project_id, exclude_client=client_id)
            },
        },
    )
    await manager.broadcast(
        project_id,
        {
            "type": "presence.join",
            "origin": client_id,
            "payload": {"user": presence_user},
        },
        exclude_client=client_id,
    )

    try:
        while True:
            raw = await websocket.receive_text()
            # Dispatch by message type. Malformed frames / non-dict payloads are
            # ignored rather than fatal so a bad frame can't kill the loop.
            try:
                msg = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if not isinstance(msg, dict):
                continue
            mtype = msg.get("type")

            if mtype == "presence.cursor":
                await manager.broadcast(
                    project_id,
                    {
                        "type": "presence.cursor",
                        "origin": client_id,
                        "payload": {
                            "user": presence_user,
                            "x": msg.get("x"),
                            "y": msg.get("y"),
                        },
                    },
                    exclude_client=client_id,
                )
            elif mtype == "presence.select":
                await manager.broadcast(
                    project_id,
                    {
                        "type": "presence.select",
                        "origin": client_id,
                        "payload": {
                            "user": presence_user,
                            "nodeId": msg.get("nodeId"),
                        },
                    },
                    exclude_client=client_id,
                )
            elif mtype == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            # Anything else: ignore.
    except WebSocketDisconnect:
        pass
    finally:
        # Presence leave: tell the room this client is gone, then deregister.
        await manager.broadcast(
            project_id,
            {"type": "presence.leave", "origin": client_id, "payload": {}},
            exclude_client=client_id,
        )
        await manager.disconnect(project_id, conn)
