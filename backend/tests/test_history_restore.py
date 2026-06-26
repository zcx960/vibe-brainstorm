"""Tests for the history dropdown: listing recent restore points and rolling
the project back to a chosen point (dropping every change made after it)."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _register(client: TestClient, username: str = "histuser") -> str:
    resp = client.post(
        "/api/auth/register",
        json={"username": username, "password": "pw123456"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["token"]


def _create_project(client: TestClient, token: str) -> str:
    resp = client.post(
        "/api/projects", json={"name": "History"}, headers=_auth(token)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _create_node(client: TestClient, token: str, project_id: str, title: str) -> dict:
    resp = client.post(
        f"/api/projects/{project_id}/nodes",
        json={"title": title, "content": "", "data": {"position": {"x": 0, "y": 0}}},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _node_ids(client: TestClient, token: str, project_id: str) -> set[str]:
    graph = client.get(
        f"/api/projects/{project_id}/graph", headers=_auth(token)
    ).json()
    return {n["id"] for n in graph["nodes"]}


def test_history_list_newest_first(client: TestClient) -> None:
    token = _register(client)
    project_id = _create_project(client, token)
    _create_node(client, token, project_id, "A")
    _create_node(client, token, project_id, "B")
    _create_node(client, token, project_id, "C")

    resp = client.get(
        f"/api/projects/{project_id}/history/list", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    entries = resp.json()["entries"]
    assert len(entries) == 3
    assert all(e["action"] == "node.create" for e in entries)
    # Newest first: created_at is descending.
    stamps = [e["created_at"] for e in entries]
    assert stamps == sorted(stamps, reverse=True)
    for e in entries:
        assert e["id"] and e["created_at"]


def test_history_list_caps_at_ten(client: TestClient) -> None:
    token = _register(client, "histcap")
    project_id = _create_project(client, token)
    for i in range(14):
        _create_node(client, token, project_id, f"n{i}")

    resp = client.get(
        f"/api/projects/{project_id}/history/list", headers=_auth(token)
    )
    assert len(resp.json()["entries"]) == 10


def test_restore_to_point_drops_newer_entries(client: TestClient) -> None:
    token = _register(client, "histrestore")
    project_id = _create_project(client, token)
    a = _create_node(client, token, project_id, "A")  # snapshot before: {}
    b = _create_node(client, token, project_id, "B")  # snapshot before: {A}
    c = _create_node(client, token, project_id, "C")  # snapshot before: {A,B}

    assert _node_ids(client, token, project_id) == {a["id"], b["id"], c["id"]}

    entries = client.get(
        f"/api/projects/{project_id}/history/list", headers=_auth(token)
    ).json()["entries"]
    # entries[0] precedes creating C ({A,B}); entries[1] precedes B ({A}).
    target = entries[1]  # restore to the state just before B was created

    resp = client.post(
        f"/api/projects/{project_id}/history/restore/{target['id']}",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    restored = resp.json()
    assert {n["id"] for n in restored["nodes"]} == {a["id"]}

    # Graph really rolled back to just {A}.
    assert _node_ids(client, token, project_id) == {a["id"]}

    # Target + every newer entry were consumed; one older entry remains.
    status = client.get(
        f"/api/projects/{project_id}/history", headers=_auth(token)
    ).json()
    assert status["count"] == 1


def test_restore_unknown_id_404(client: TestClient) -> None:
    token = _register(client, "histmissing")
    project_id = _create_project(client, token)
    _create_node(client, token, project_id, "A")

    resp = client.post(
        f"/api/projects/{project_id}/history/restore/nope-id",
        headers=_auth(token),
    )
    assert resp.status_code == 404, resp.text
