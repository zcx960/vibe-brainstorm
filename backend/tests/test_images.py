from __future__ import annotations

import json
from pathlib import Path
from typing import ClassVar

import anyio
from fastapi.testclient import TestClient

from app.config import get_settings
from app.llm.image import GeneratedImage

PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4"
    b"\x89\x00\x00\x00\nIDATx\x9cc\xf8\x0f\x00\x01\x01"
    b"\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
)


class _FakeImageProvider:
    active: ClassVar[int] = 0
    max_active: ClassVar[int] = 0
    calls: ClassVar[int] = 0
    reference_batches: ClassVar[list[list[bytes]]] = []

    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url
        self.api_key = api_key

    async def generate_image(
        self, *, prompt: str, model: str, size: str, reference_images=()
    ) -> GeneratedImage:
        type(self).active += 1
        type(self).max_active = max(type(self).max_active, type(self).active)
        type(self).calls += 1
        type(self).reference_batches.append(
            [reference.data for reference in reference_images]
        )
        try:
            await anyio.sleep(0.02)
            return GeneratedImage(
                data=PNG_BYTES,
                mime_type="image/png",
                prompt=f"{prompt} / {model} / {size}",
            )
        finally:
            type(self).active -= 1


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _register(client: TestClient) -> str:
    resp = client.post(
        "/api/auth/register",
        json={"username": "imageuser", "password": "pw123456"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["token"]


def _admin_token(client: TestClient) -> str:
    resp = client.post("/api/admin/login", json={"password": "admin123"})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _make_project_with_node(client: TestClient, token: str) -> tuple[str, str]:
    project_resp = client.post(
        "/api/projects",
        json={"name": "Image Project"},
        headers=_auth(token),
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]
    node_resp = client.post(
        f"/api/projects/{project_id}/nodes",
        json={
            "title": "赛博花园",
            "content": "玻璃温室，夜色，霓虹植物",
            "data": {"position": {"x": 24, "y": 32}},
        },
        headers=_auth(token),
    )
    assert node_resp.status_code == 201, node_resp.text
    return project_id, node_resp.json()["id"]


def _create_image_node(
    client: TestClient,
    token: str,
    project_id: str,
    *,
    title: str,
    media_path: Path,
    image_url: str,
) -> str:
    resp = client.post(
        f"/api/projects/{project_id}/nodes",
        json={
            "title": title,
            "content": "",
            "data": {
                "kind": "image",
                "image_url": image_url,
                "media_path": str(media_path),
                "prompt": title,
                "position": {"x": 0, "y": 0},
            },
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _create_edge(
    client: TestClient,
    token: str,
    project_id: str,
    *,
    source_id: str,
    target_id: str,
) -> None:
    resp = client.post(
        f"/api/projects/{project_id}/edges",
        json={"source_id": source_id, "target_id": target_id},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text


def _create_image_provider(client: TestClient) -> None:
    token = _admin_token(client)
    resp = client.post(
        "/api/admin/providers",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "key": "imagehub",
            "name": "Image Hub",
            "base_url": "https://image.example.com/v1",
            "api_key": "sk-image",
            "models": ["chat-a"],
            "image_models": ["image-a"],
            "enabled": True,
        },
    )
    assert resp.status_code == 201, resp.text


def _sse_events(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for frame in text.replace("\r\n", "\n").strip().split("\n\n"):
        event = "message"
        data = ""
        for line in frame.splitlines():
            if line.startswith("event:"):
                event = line.removeprefix("event:").strip()
            if line.startswith("data:"):
                data += line.removeprefix("data:").strip()
        if data:
            events.append((event, json.loads(data)))
    return events


def test_image_generate_stream_persists_nodes_and_media(
    client: TestClient, monkeypatch, tmp_path: Path
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "media_dir", str(tmp_path))
    monkeypatch.setattr(
        "app.services.imagegen.OpenAICompatibleImageProvider",
        _FakeImageProvider,
    )
    _FakeImageProvider.active = 0
    _FakeImageProvider.max_active = 0
    _FakeImageProvider.calls = 0
    _FakeImageProvider.reference_batches = []

    user_token = _register(client)
    project_id, node_id = _make_project_with_node(client, user_token)
    _create_image_provider(client)

    with client.stream(
        "POST",
        "/api/images/generate",
        json={
            "project_id": project_id,
            "node_id": node_id,
            "provider": "imagehub",
            "model": "image-a",
            "count": 3,
            "prompt": "生成三张海报风格图片",
            "size": "1024x1024",
        },
        headers=_auth(user_token),
    ) as resp:
        assert resp.status_code == 200, resp.text
        events = _sse_events("".join(resp.iter_text()))

    image_events = [payload for event, payload in events if event == "image"]
    done_events = [payload for event, payload in events if event == "done"]

    assert len(image_events) == 3
    assert len(done_events) == 1
    assert done_events[0]["count_ok"] == 3
    assert done_events[0]["count_failed"] == 0
    assert _FakeImageProvider.calls == 3
    assert _FakeImageProvider.max_active > 1
    assert _FakeImageProvider.reference_batches == [[], [], []]

    for payload in image_events:
        node = payload["node"]
        edge = payload["edge"]
        assert node["parent_id"] == node_id
        assert node["data"]["kind"] == "image"
        assert node["data"]["image_url"].startswith("/api/media/images/")
        assert node["data"]["prompt"].startswith("生成三张海报风格图片")
        assert edge["source_id"] == node_id
        assert edge["target_id"] == node["id"]
        media_path = tmp_path / node["data"]["image_url"].removeprefix("/api/media/")
        assert media_path.exists()
        assert media_path.read_bytes() == PNG_BYTES


def test_image_generate_rejects_more_than_ten(client: TestClient) -> None:
    user_token = _register(client)
    project_id, node_id = _make_project_with_node(client, user_token)

    resp = client.post(
        "/api/images/generate",
        json={
            "project_id": project_id,
            "node_id": node_id,
            "provider": "imagehub",
            "model": "image-a",
            "count": 11,
        },
        headers=_auth(user_token),
    )

    assert resp.status_code == 422, resp.text


def test_image_generate_uses_current_and_upstream_images_as_references(
    client: TestClient, monkeypatch, tmp_path: Path
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "media_dir", str(tmp_path))
    monkeypatch.setattr(
        "app.services.imagegen.OpenAICompatibleImageProvider",
        _FakeImageProvider,
    )
    _FakeImageProvider.active = 0
    _FakeImageProvider.max_active = 0
    _FakeImageProvider.calls = 0
    _FakeImageProvider.reference_batches = []

    user_token = _register(client)
    project_id, _ = _make_project_with_node(client, user_token)
    _create_image_provider(client)

    refs_dir = tmp_path / "refs"
    refs_dir.mkdir()
    current_bytes = b"current-reference"
    current_path = refs_dir / "current.png"
    current_path.write_bytes(current_bytes)
    current_id = _create_image_node(
        client,
        user_token,
        project_id,
        title="当前图片",
        media_path=current_path,
        image_url="/api/media/refs/current.png",
    )

    for index in range(5):
        upstream_path = refs_dir / f"upstream-{index}.png"
        upstream_path.write_bytes(f"upstream-{index}".encode())
        upstream_id = _create_image_node(
            client,
            user_token,
            project_id,
            title=f"上级参考 {index}",
            media_path=upstream_path,
            image_url=f"/api/media/refs/upstream-{index}.png",
        )
        _create_edge(
            client,
            user_token,
            project_id,
            source_id=upstream_id,
            target_id=current_id,
        )

    with client.stream(
        "POST",
        "/api/images/generate",
        json={
            "project_id": project_id,
            "node_id": current_id,
            "provider": "imagehub",
            "model": "image-a",
            "count": 1,
            "prompt": "基于参考图做一版角色变体",
            "size": "1024x1024",
        },
        headers=_auth(user_token),
    ) as resp:
        assert resp.status_code == 200, resp.text
        events = _sse_events("".join(resp.iter_text()))

    done_events = [payload for event, payload in events if event == "done"]
    assert done_events[0]["count_ok"] == 1
    assert _FakeImageProvider.calls == 1
    assert len(_FakeImageProvider.reference_batches) == 1
    assert len(_FakeImageProvider.reference_batches[0]) == 4
    assert _FakeImageProvider.reference_batches[0][0] == current_bytes


def test_position_patch_preserves_image_metadata(client: TestClient) -> None:
    user_token = _register(client)
    project_id, node_id = _make_project_with_node(client, user_token)

    patch_resp = client.patch(
        f"/api/projects/{project_id}/nodes/{node_id}",
        json={
            "data": {
                "kind": "image",
                "image_url": "/api/media/images/demo.png",
                "prompt": "demo",
                "position": {"x": 1, "y": 2},
            }
        },
        headers=_auth(user_token),
    )
    assert patch_resp.status_code == 200, patch_resp.text

    position_resp = client.patch(
        f"/api/projects/{project_id}/nodes/{node_id}",
        json={"data": {"position": {"x": 9, "y": 10}}},
        headers=_auth(user_token),
    )
    assert position_resp.status_code == 200, position_resp.text
    data = position_resp.json()["data"]

    assert data["position"] == {"x": 9, "y": 10}
    assert data["kind"] == "image"
    assert data["image_url"] == "/api/media/images/demo.png"
    assert data["prompt"] == "demo"
