"""Admin panel tests: password login + provider CRUD + key-never-leaked.

These run over the standard `client` fixture (lifespan disabled, so the provider
table starts empty); providers are created via the admin API.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

ADMIN_PW = "admin123"  # matches Settings default in tests (no ADMIN_PASSWORD env)


def _admin_token(client: TestClient) -> str:
    resp = client.post("/api/admin/login", json={"password": ADMIN_PW})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _admin(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_admin_login_wrong_password_401(client: TestClient) -> None:
    resp = client.post("/api/admin/login", json={"password": "nope"})
    assert resp.status_code == 401, resp.text


def test_admin_login_ok(client: TestClient) -> None:
    assert _admin_token(client)


def test_admin_routes_require_token(client: TestClient) -> None:
    # No token.
    assert client.get("/api/admin/providers").status_code == 401
    # A normal user token is not an admin token.
    user = client.post(
        "/api/auth/register", json={"username": "normaluser", "password": "pw123456"}
    ).json()
    resp = client.get(
        "/api/admin/providers",
        headers={"Authorization": f"Bearer {user['token']}"},
    )
    assert resp.status_code == 401, resp.text


def test_provider_crud_and_key_never_leaked(client: TestClient) -> None:
    token = _admin_token(client)

    # Create with a key.
    resp = client.post(
        "/api/admin/providers",
        headers=_admin(token),
        json={
            "key": "mymodel",
            "name": "我的私有模型",
            "base_url": "https://my-llm.example.com/v1",
            "api_key": "sk-secret-123",
            "models": ["m-a", "m-b"],
            "image_models": ["img-a", "img-b"],
            "enabled": True,
        },
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    pid = created["id"]
    assert created["has_key"] is True
    assert "api_key" not in created  # raw key never serialized

    # List: still no raw key, has_key true.
    listed = client.get("/api/admin/providers", headers=_admin(token)).json()["providers"]
    row = next(p for p in listed if p["id"] == pid)
    assert row["has_key"] is True
    assert "api_key" not in row

    # Appears to users as available (enabled + has key).
    pub = client.get("/api/config/providers").json()["providers"]
    upub = next(p for p in pub if p["id"] == "mymodel")
    assert upub["available"] is True
    assert upub["name"] == "我的私有模型"
    assert upub["models"] == ["m-a", "m-b"]
    assert upub["image_models"] == ["img-a", "img-b"]
    assert "api_key" not in upub

    # Patch name only -> key preserved (has_key stays true).
    resp = client.patch(
        f"/api/admin/providers/{pid}",
        headers=_admin(token),
        json={"name": "改个名", "image_models": ["img-c"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "改个名"
    assert resp.json()["image_models"] == ["img-c"]
    assert resp.json()["has_key"] is True

    # Patch enabled=false -> disappears from the user-facing list.
    client.patch(
        f"/api/admin/providers/{pid}", headers=_admin(token), json={"enabled": False}
    )
    pub2 = client.get("/api/config/providers").json()["providers"]
    assert all(p["id"] != "mymodel" for p in pub2)

    # Delete.
    resp = client.delete(f"/api/admin/providers/{pid}", headers=_admin(token))
    assert resp.status_code == 204, resp.text
    listed2 = client.get("/api/admin/providers", headers=_admin(token)).json()["providers"]
    assert all(p["id"] != pid for p in listed2)


def test_provider_without_key_not_available(client: TestClient) -> None:
    token = _admin_token(client)
    client.post(
        "/api/admin/providers",
        headers=_admin(token),
        json={
            "key": "nokey",
            "name": "缺密钥",
            "base_url": "https://x.example.com/v1",
            "models": ["m"],
        },
    )
    pub = client.get("/api/config/providers").json()["providers"]
    row = next(p for p in pub if p["id"] == "nokey")
    assert row["available"] is False


def test_duplicate_provider_key_409(client: TestClient) -> None:
    token = _admin_token(client)
    body = {"key": "dup", "name": "A", "base_url": "https://a/v1", "models": []}
    assert client.post("/api/admin/providers", headers=_admin(token), json=body).status_code == 201
    assert client.post("/api/admin/providers", headers=_admin(token), json=body).status_code == 409
