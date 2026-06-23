"""End-to-end auth tests: register -> login -> me, plus error cases."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_register_login_me_happy_path(client: TestClient) -> None:
    # Register.
    resp = client.post(
        "/api/auth/register",
        json={"username": "alice", "password": "secret123", "display_name": "Alice"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["token"]
    assert body["user"]["username"] == "alice"
    assert body["user"]["display_name"] == "Alice"
    assert body["user"]["color"].startswith("#")

    # Login.
    resp = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "secret123"},
    )
    assert resp.status_code == 200, resp.text
    login_body = resp.json()
    token = login_body["token"]
    assert token
    assert login_body["user"]["username"] == "alice"

    # Me (authenticated).
    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    me = resp.json()
    assert me["username"] == "alice"
    assert me["display_name"] == "Alice"


def test_register_default_display_name_from_username(client: TestClient) -> None:
    resp = client.post(
        "/api/auth/register",
        json={"username": "bob", "password": "pw12345"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["user"]["display_name"] == "bob"


def test_duplicate_username_409(client: TestClient) -> None:
    payload = {"username": "dupuser", "password": "pw12345"}
    first = client.post("/api/auth/register", json=payload)
    assert first.status_code == 201, first.text

    second = client.post("/api/auth/register", json=payload)
    assert second.status_code == 409, second.text


def test_short_username_422(client: TestClient) -> None:
    resp = client.post(
        "/api/auth/register",
        json={"username": "ab", "password": "pw12345"},
    )
    assert resp.status_code == 422, resp.text


def test_bad_password_401(client: TestClient) -> None:
    client.post(
        "/api/auth/register",
        json={"username": "carol", "password": "rightpassword"},
    )
    resp = client.post(
        "/api/auth/login",
        json={"username": "carol", "password": "wrongpassword"},
    )
    assert resp.status_code == 401, resp.text


def test_me_without_token_401(client: TestClient) -> None:
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401, resp.text


def test_me_with_invalid_token_401(client: TestClient) -> None:
    resp = client.get(
        "/api/auth/me", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert resp.status_code == 401, resp.text
