from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.config import get_settings

PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4"
    b"\x89\x00\x00\x00\nIDATx\x9cc\xf8\x0f\x00\x01\x01"
    b"\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _register(client: TestClient) -> str:
    resp = client.post(
        "/api/auth/register",
        json={"username": "uploaduser", "password": "pw123456"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["token"]


def _make_project_with_node(client: TestClient, token: str) -> tuple[str, str]:
    project_resp = client.post(
        "/api/projects",
        json={"name": "Upload Project"},
        headers=_auth(token),
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]
    node_resp = client.post(
        f"/api/projects/{project_id}/nodes",
        json={
            "title": "角色设定",
            "content": "用于接收上传参考图",
            "data": {"position": {"x": 24, "y": 32}},
        },
        headers=_auth(token),
    )
    assert node_resp.status_code == 201, node_resp.text
    return project_id, node_resp.json()["id"]


def test_upload_image_node_creates_parented_image_node_and_media(
    client: TestClient, monkeypatch, tmp_path: Path
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "media_dir", str(tmp_path))

    token = _register(client)
    project_id, parent_id = _make_project_with_node(client, token)

    resp = client.post(
        "/api/images/upload",
        data={
            "project_id": project_id,
            "parent_id": parent_id,
            "title": "角色参考图",
            "content": "用户上传的参考图",
            "x": "320",
            "y": "96",
        },
        files={"file": ("character.png", PNG_BYTES, "image/png")},
        headers=_auth(token),
    )

    assert resp.status_code == 201, resp.text
    payload = resp.json()
    node = payload["node"]
    edge = payload["edge"]

    assert node["parent_id"] == parent_id
    assert node["title"] == "角色参考图"
    assert node["content"] == "用户上传的参考图"
    assert node["data"]["kind"] == "image"
    assert node["data"]["source"] == "upload"
    assert node["data"]["prompt"] == "用户上传的参考图"
    assert node["data"]["position"] == {"x": 320.0, "y": 96.0}
    assert node["data"]["image_url"].startswith("/api/media/images/")
    assert edge["source_id"] == parent_id
    assert edge["target_id"] == node["id"]

    media_path = Path(node["data"]["media_path"])
    assert media_path.exists()
    assert media_path.read_bytes() == PNG_BYTES


def test_upload_image_node_rejects_non_image_file(client: TestClient) -> None:
    token = _register(client)
    project_id, _parent_id = _make_project_with_node(client, token)

    resp = client.post(
        "/api/images/upload",
        data={"project_id": project_id, "title": "不是图片"},
        files={"file": ("note.txt", b"plain text", "text/plain")},
        headers=_auth(token),
    )

    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == "上传的文件不是有效图片"


def test_upload_image_node_rejects_files_above_twenty_five_mb(
    client: TestClient,
) -> None:
    token = _register(client)
    project_id, _parent_id = _make_project_with_node(client, token)
    oversized_png = PNG_BYTES + (b"0" * (25 * 1024 * 1024))

    resp = client.post(
        "/api/images/upload",
        data={"project_id": project_id, "title": "过大的图片"},
        files={"file": ("large.png", oversized_png, "image/png")},
        headers=_auth(token),
    )

    assert resp.status_code == 413, resp.text
    assert resp.json()["detail"] == "图片不能超过 25MB"
