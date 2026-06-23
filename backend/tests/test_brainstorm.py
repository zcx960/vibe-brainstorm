from __future__ import annotations

from fastapi.testclient import TestClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _register(client: TestClient) -> str:
    resp = client.post(
        "/api/auth/register",
        json={"username": "brainstormer", "password": "pw123456"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["token"]


def _make_project_with_node(client: TestClient, token: str) -> tuple[str, str]:
    project_resp = client.post(
        "/api/projects",
        json={"name": "Brainstorm Project"},
        headers=_auth(token),
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]
    node_resp = client.post(
        f"/api/projects/{project_id}/nodes",
        json={
            "title": "中心主题",
            "content": "测试脑爆数量限制",
            "data": {"position": {"x": 0, "y": 0}},
        },
        headers=_auth(token),
    )
    assert node_resp.status_code == 201, node_resp.text
    return project_id, node_resp.json()["id"]


def test_brainstorm_rejects_count_below_one(client: TestClient) -> None:
    token = _register(client)
    project_id, node_id = _make_project_with_node(client, token)

    resp = client.post(
        "/api/brainstorm/expand",
        json={
            "project_id": project_id,
            "node_id": node_id,
            "mode": "general",
            "provider": "missing",
            "model": "missing",
            "count": 0,
        },
        headers=_auth(token),
    )

    assert resp.status_code == 422, resp.text


def test_brainstorm_rejects_count_above_ten(client: TestClient) -> None:
    token = _register(client)
    project_id, node_id = _make_project_with_node(client, token)

    resp = client.post(
        "/api/brainstorm/expand",
        json={
            "project_id": project_id,
            "node_id": node_id,
            "mode": "general",
            "provider": "missing",
            "model": "missing",
            "count": 11,
        },
        headers=_auth(token),
    )

    assert resp.status_code == 422, resp.text
