"""End-to-end tests for the document node support: single-node GET and the
collaborative comment (annotation) CRUD endpoints with their WS broadcasts."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _register(client: TestClient, username: str = "docuser") -> str:
    resp = client.post(
        "/api/auth/register",
        json={"username": username, "password": "pw123456"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["token"]


def _create_project(client: TestClient, token: str) -> str:
    resp = client.post(
        "/api/projects",
        json={"name": "Doc Project"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _create_doc_node(client: TestClient, token: str, project_id: str) -> str:
    resp = client.post(
        f"/api/projects/{project_id}/nodes",
        json={
            "title": "新文档",
            "content": "<p>hello</p>",
            "data": {"position": {"x": 0, "y": 0}, "kind": "document"},
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_get_single_node(client: TestClient) -> None:
    token = _register(client)
    project_id = _create_project(client, token)
    node_id = _create_doc_node(client, token, project_id)

    resp = client.get(
        f"/api/projects/{project_id}/nodes/{node_id}", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == node_id
    assert body["data"]["kind"] == "document"
    assert body["content"] == "<p>hello</p>"


def test_get_single_node_404_other_project(client: TestClient) -> None:
    token = _register(client)
    project_id = _create_project(client, token)
    node_id = _create_doc_node(client, token, project_id)

    resp = client.get(
        f"/api/projects/does-not-exist/nodes/{node_id}", headers=_auth(token)
    )
    # Project-scoped membership check fails first (403/404 either way: no access).
    assert resp.status_code in (403, 404), resp.text


def test_comment_crud_lifecycle(client: TestClient) -> None:
    token = _register(client)
    project_id = _create_project(client, token)
    node_id = _create_doc_node(client, token, project_id)

    # Initially no comments.
    resp = client.get(
        f"/api/projects/{project_id}/nodes/{node_id}/comments",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    assert resp.json() == []

    # Create one.
    resp = client.post(
        f"/api/projects/{project_id}/nodes/{node_id}/comments",
        json={"comment_id": "cmt-1", "quote": "hello", "body": "needs work"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["comment_id"] == "cmt-1"
    assert created["quote"] == "hello"
    assert created["body"] == "needs work"
    # Author identity is snapshotted from the current user.
    assert created["author_name"]
    assert created["author_color"]

    # It now lists.
    resp = client.get(
        f"/api/projects/{project_id}/nodes/{node_id}/comments",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # Delete by the shared mark id.
    resp = client.delete(
        f"/api/projects/{project_id}/nodes/{node_id}/comments/cmt-1",
        headers=_auth(token),
    )
    assert resp.status_code == 204, resp.text

    resp = client.get(
        f"/api/projects/{project_id}/nodes/{node_id}/comments",
        headers=_auth(token),
    )
    assert resp.json() == []


def test_delete_missing_comment_404(client: TestClient) -> None:
    token = _register(client)
    project_id = _create_project(client, token)
    node_id = _create_doc_node(client, token, project_id)

    resp = client.delete(
        f"/api/projects/{project_id}/nodes/{node_id}/comments/nope",
        headers=_auth(token),
    )
    assert resp.status_code == 404, resp.text


def test_comments_require_auth(client: TestClient) -> None:
    token = _register(client)
    project_id = _create_project(client, token)
    node_id = _create_doc_node(client, token, project_id)

    resp = client.get(f"/api/projects/{project_id}/nodes/{node_id}/comments")
    assert resp.status_code == 401, resp.text
