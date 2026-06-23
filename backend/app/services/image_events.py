from __future__ import annotations

from typing import TypeAlias

from app.models import Edge, Node
from app.realtime import manager
from app.schemas import EdgeOut, NodeOut

JsonValue: TypeAlias = (
    str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
)


def node_out_dict(node: Node) -> dict[str, JsonValue]:
    return NodeOut.model_validate(node).model_dump(mode="json")


def edge_out_dict(edge: Edge) -> dict[str, JsonValue]:
    return EdgeOut.model_validate(edge).model_dump(mode="json")


async def broadcast_created(
    project_id: str,
    *,
    node: Node,
    edge: Edge,
    client_id: str | None,
) -> None:
    await manager.broadcast(
        project_id,
        {
            "type": "node.created",
            "origin": client_id,
            "payload": {"node": node_out_dict(node)},
        },
        exclude_client=client_id,
    )
    await manager.broadcast(
        project_id,
        {
            "type": "edge.created",
            "origin": client_id,
            "payload": {"edge": edge_out_dict(edge)},
        },
        exclude_client=client_id,
    )
