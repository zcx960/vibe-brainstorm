"""End-to-end membership / permission tests.

Covers: owner creation, non-member 403s, share-link accept -> editor access,
owner-only delete + share, and member removal.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def _register(client: TestClient, username: str) -> tuple[str, str]:
    """Register a user; return (token, user_id)."""
    resp = client.post(
        "/api/auth/register", json={"username": username, "password": "pw123456"}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["token"], body["user"]["id"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_membership_sharing_and_permissions(client: TestClient) -> None:
    a_token, a_id = _register(client, "owner@example.com")
    b_token, b_id = _register(client, "guest@example.com")

    # A creates a project -> becomes owner.
    resp = client.post("/api/projects", json={"name": "Plan"}, headers=_auth(a_token))
    assert resp.status_code == 201, resp.text
    project = resp.json()
    pid = project["id"]
    assert project["role"] == "owner"

    # A's project list includes it with role owner.
    resp = client.get("/api/projects", headers=_auth(a_token))
    assert resp.status_code == 200
    listed = resp.json()["projects"]
    assert any(p["id"] == pid and p["role"] == "owner" for p in listed)

    # B is NOT a member: cannot list it, cannot read graph, cannot create a node.
    resp = client.get("/api/projects", headers=_auth(b_token))
    assert resp.status_code == 200
    assert all(p["id"] != pid for p in resp.json()["projects"])

    resp = client.get(f"/api/projects/{pid}/graph", headers=_auth(b_token))
    assert resp.status_code == 403, resp.text

    resp = client.post(
        f"/api/projects/{pid}/nodes",
        json={"title": "B node"},
        headers=_auth(b_token),
    )
    assert resp.status_code == 403, resp.text

    # B cannot create a share link (owner-only).
    resp = client.post(f"/api/projects/{pid}/share", headers=_auth(b_token))
    assert resp.status_code == 403, resp.text

    # A creates a share link (owner-only) and reuses it on repeat call.
    resp = client.post(f"/api/projects/{pid}/share", headers=_auth(a_token))
    assert resp.status_code == 200, resp.text
    share = resp.json()
    token_value = share["token"]
    assert share["url"] == f"/?join={token_value}"
    assert share["role"] == "editor"

    resp2 = client.post(f"/api/projects/{pid}/share", headers=_auth(a_token))
    assert resp2.status_code == 200
    assert resp2.json()["token"] == token_value  # reused, not regenerated

    # B accepts the share link -> becomes an editor.
    resp = client.post(
        f"/api/share/{token_value}/accept", headers=_auth(b_token)
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "editor"

    # Accept is idempotent.
    resp = client.post(
        f"/api/share/{token_value}/accept", headers=_auth(b_token)
    )
    assert resp.status_code == 200, resp.text

    # B can now read the graph and create a node.
    resp = client.get(f"/api/projects/{pid}/graph", headers=_auth(b_token))
    assert resp.status_code == 200, resp.text

    resp = client.post(
        f"/api/projects/{pid}/nodes",
        json={"title": "B node"},
        headers=_auth(b_token),
    )
    assert resp.status_code == 201, resp.text

    # The project now appears in B's list as editor.
    resp = client.get("/api/projects", headers=_auth(b_token))
    assert any(
        p["id"] == pid and p["role"] == "editor" for p in resp.json()["projects"]
    )

    # Members listing (any member can read) shows both A (owner) and B (editor).
    resp = client.get(f"/api/projects/{pid}/members", headers=_auth(b_token))
    assert resp.status_code == 200, resp.text
    members = resp.json()["members"]
    roles_by_id = {m["user"]["id"]: m["role"] for m in members}
    assert roles_by_id.get(a_id) == "owner"
    assert roles_by_id.get(b_id) == "editor"

    # B (editor) cannot DELETE the project; only the owner can.
    resp = client.delete(f"/api/projects/{pid}", headers=_auth(b_token))
    assert resp.status_code == 403, resp.text

    # B (editor) cannot remove a member (owner-only).
    resp = client.delete(
        f"/api/projects/{pid}/members/{b_id}", headers=_auth(b_token)
    )
    assert resp.status_code == 403, resp.text

    # Owner cannot remove themselves via this route.
    resp = client.delete(
        f"/api/projects/{pid}/members/{a_id}", headers=_auth(a_token)
    )
    assert resp.status_code == 400, resp.text

    # Owner removes B successfully.
    resp = client.delete(
        f"/api/projects/{pid}/members/{b_id}", headers=_auth(a_token)
    )
    assert resp.status_code == 204, resp.text

    # B is no longer a member -> 403 on graph again.
    resp = client.get(f"/api/projects/{pid}/graph", headers=_auth(b_token))
    assert resp.status_code == 403, resp.text

    # Owner CAN delete the project.
    resp = client.delete(f"/api/projects/{pid}", headers=_auth(a_token))
    assert resp.status_code == 204, resp.text


def test_unknown_project_and_unauth(client: TestClient) -> None:
    a_token, _ = _register(client, "solo@example.com")

    # Graph on a non-existent project for an authenticated user -> 404.
    resp = client.get(
        "/api/projects/00000000-0000-0000-0000-0000000000ff/graph",
        headers=_auth(a_token),
    )
    assert resp.status_code == 404, resp.text

    # No auth at all -> 401 on a protected project route.
    resp = client.get("/api/projects")
    assert resp.status_code == 401, resp.text


def test_accept_invalid_token_404(client: TestClient) -> None:
    a_token, _ = _register(client, "x@example.com")
    resp = client.post("/api/share/does-not-exist/accept", headers=_auth(a_token))
    assert resp.status_code == 404, resp.text
