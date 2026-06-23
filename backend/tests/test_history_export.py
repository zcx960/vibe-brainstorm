from __future__ import annotations

from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
import zipfile

from fastapi.testclient import TestClient

from app.config import get_settings
from app.schemas import GraphOut, NodeOut
from app.services.export_docx import build_project_docx

PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4"
    b"\x89\x00\x00\x00\nIDATx\x9cc\xf8\x0f\x00\x01\x01"
    b"\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
)

BASE_TIME = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _doc_node(
    node_id: str,
    title: str,
    *,
    parent_id: str | None = None,
    minutes: int = 0,
) -> NodeOut:
    return NodeOut(
        id=node_id,
        project_id="project",
        parent_id=parent_id,
        title=title,
        content="",
        data={},
        created_at=BASE_TIME + timedelta(minutes=minutes),
    )


def _register(client: TestClient, username: str = "historyuser") -> str:
    resp = client.post(
        "/api/auth/register",
        json={"username": username, "password": "pw123456"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["token"]


def _create_project(client: TestClient, token: str) -> str:
    resp = client.post(
        "/api/projects",
        json={"name": "History Export Project"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _create_node(
    client: TestClient,
    token: str,
    project_id: str,
    title: str,
    content: str = "",
    parent_id: str | None = None,
    x: float = 0,
    y: float = 0,
    headers: dict[str, str] | None = None,
) -> dict:
    resp = client.post(
        f"/api/projects/{project_id}/nodes",
        json={
            "parent_id": parent_id,
            "title": title,
            "content": content,
            "data": {"position": {"x": x, "y": y}},
        },
        headers={**_auth(token), **(headers or {})},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_edge(
    client: TestClient,
    token: str,
    project_id: str,
    source_id: str,
    target_id: str,
    headers: dict[str, str] | None = None,
) -> dict:
    resp = client.post(
        f"/api/projects/{project_id}/edges",
        json={"source_id": source_id, "target_id": target_id},
        headers={**_auth(token), **(headers or {})},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _share_with_editor(
    client: TestClient,
    owner_token: str,
    editor_token: str,
    project_id: str,
) -> None:
    share_resp = client.post(
        f"/api/projects/{project_id}/share",
        headers=_auth(owner_token),
    )
    assert share_resp.status_code == 200, share_resp.text
    token_value = share_resp.json()["token"]
    accept_resp = client.post(
        f"/api/share/{token_value}/accept",
        headers=_auth(editor_token),
    )
    assert accept_resp.status_code == 200, accept_resp.text


def _docx_document_xml(content: bytes) -> str:
    with zipfile.ZipFile(BytesIO(content)) as zf:
        return zf.read("word/document.xml").decode("utf-8")


def test_delete_node_records_project_snapshot_and_undo_restores_graph(
    client: TestClient,
) -> None:
    token = _register(client)
    project_id = _create_project(client, token)
    root = _create_node(client, token, project_id, "根节点", "根内容")
    child = _create_node(
        client,
        token,
        project_id,
        "子节点",
        "子内容",
        parent_id=root["id"],
        x=240,
        y=120,
    )
    edge = _create_edge(client, token, project_id, root["id"], child["id"])

    delete_resp = client.delete(
        f"/api/projects/{project_id}/nodes/{child['id']}",
        headers=_auth(token),
    )
    assert delete_resp.status_code == 204, delete_resp.text

    graph_after_delete = client.get(
        f"/api/projects/{project_id}/graph", headers=_auth(token)
    ).json()
    assert [node["id"] for node in graph_after_delete["nodes"]] == [root["id"]]
    assert graph_after_delete["edges"] == []

    undo_resp = client.post(
        f"/api/projects/{project_id}/history/undo",
        headers=_auth(token),
    )
    assert undo_resp.status_code == 200, undo_resp.text
    restored = undo_resp.json()
    assert {node["id"] for node in restored["nodes"]} == {root["id"], child["id"]}
    assert {item["id"] for item in restored["edges"]} == {edge["id"]}
    restored_child = next(node for node in restored["nodes"] if node["id"] == child["id"])
    assert restored_child["parent_id"] == root["id"]
    assert restored_child["title"] == "子节点"

    history_resp = client.get(
        f"/api/projects/{project_id}/history", headers=_auth(token)
    )
    assert history_resp.status_code == 200, history_resp.text
    assert history_resp.json() == {"can_undo": True, "count": 3}


def test_history_keeps_only_latest_one_hundred_snapshots(
    client: TestClient,
) -> None:
    token = _register(client, "historylimit")
    project_id = _create_project(client, token)

    for index in range(101):
        _create_node(client, token, project_id, f"节点 {index}")

    history_resp = client.get(
        f"/api/projects/{project_id}/history", headers=_auth(token)
    )
    assert history_resp.status_code == 200, history_resp.text
    assert history_resp.json() == {"can_undo": True, "count": 100}


def test_history_table_does_not_modify_existing_graph_rows(
    client: TestClient,
) -> None:
    token = _register(client, "historysafe")
    project_id = _create_project(client, token)
    root = _create_node(client, token, project_id, "安全节点", "保留内容")

    graph_before = client.get(
        f"/api/projects/{project_id}/graph", headers=_auth(token)
    ).json()

    history_resp = client.get(
        f"/api/projects/{project_id}/history", headers=_auth(token)
    )
    assert history_resp.status_code == 200, history_resp.text

    graph_after = client.get(
        f"/api/projects/{project_id}/graph", headers=_auth(token)
    ).json()
    assert graph_after == graph_before
    assert graph_after["nodes"][0]["id"] == root["id"]


def test_history_is_shared_by_project_members(client: TestClient) -> None:
    owner_token = _register(client, "historyowner")
    editor_token = _register(client, "historyeditor")
    project_id = _create_project(client, owner_token)
    node = _create_node(client, owner_token, project_id, "共享节点", "原内容")
    _share_with_editor(client, owner_token, editor_token, project_id)

    edit_resp = client.patch(
        f"/api/projects/{project_id}/nodes/{node['id']}",
        json={"content": "协作者修改"},
        headers=_auth(editor_token),
    )
    assert edit_resp.status_code == 200, edit_resp.text

    owner_history = client.get(
        f"/api/projects/{project_id}/history",
        headers=_auth(owner_token),
    )
    editor_history = client.get(
        f"/api/projects/{project_id}/history",
        headers=_auth(editor_token),
    )
    assert owner_history.json() == editor_history.json()
    assert owner_history.json()["count"] == 2

    undo_resp = client.post(
        f"/api/projects/{project_id}/history/undo",
        headers=_auth(owner_token),
    )
    assert undo_resp.status_code == 200, undo_resp.text
    restored_node = next(
        item for item in undo_resp.json()["nodes"] if item["id"] == node["id"]
    )
    assert restored_node["content"] == "原内容"


def test_history_batch_and_skip_header_create_single_undo_step(
    client: TestClient,
) -> None:
    token = _register(client, "historybatch")
    project_id = _create_project(client, token)
    root = _create_node(client, token, project_id, "根节点")

    begin_resp = client.post(
        f"/api/projects/{project_id}/history/begin",
        headers=_auth(token),
    )
    assert begin_resp.status_code == 204, begin_resp.text
    child = _create_node(
        client,
        token,
        project_id,
        "批处理子节点",
        parent_id=root["id"],
        headers={"X-Skip-History": "1"},
    )
    _create_edge(
        client,
        token,
        project_id,
        root["id"],
        child["id"],
        headers={"X-Skip-History": "1"},
    )

    history_resp = client.get(
        f"/api/projects/{project_id}/history",
        headers=_auth(token),
    )
    assert history_resp.status_code == 200, history_resp.text
    assert history_resp.json() == {"can_undo": True, "count": 2}

    undo_resp = client.post(
        f"/api/projects/{project_id}/history/undo",
        headers=_auth(token),
    )
    assert undo_resp.status_code == 200, undo_resp.text
    restored = undo_resp.json()
    assert [node["id"] for node in restored["nodes"]] == [root["id"]]
    assert restored["edges"] == []


def test_export_docx_contains_text_and_embeds_local_image(
    client: TestClient,
    monkeypatch,
    tmp_path: Path,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "media_dir", str(tmp_path))

    token = _register(client, "exportuser")
    project_id = _create_project(client, token)
    root = _create_node(client, token, project_id, "根标题", "根正文")

    media_dir = tmp_path / "images"
    media_dir.mkdir(parents=True)
    image_path = media_dir / "export.png"
    image_path.write_bytes(PNG_BYTES)
    image = _create_node(
        client,
        token,
        project_id,
        "图片节点",
        "图片说明",
        parent_id=root["id"],
        x=260,
        y=0,
    )
    patch_resp = client.patch(
        f"/api/projects/{project_id}/nodes/{image['id']}",
        json={
            "data": {
                "kind": "image",
                "image_url": "/api/media/images/export.png",
                "media_path": str(image_path),
            }
        },
        headers=_auth(token),
    )
    assert patch_resp.status_code == 200, patch_resp.text
    _create_edge(client, token, project_id, root["id"], image["id"])

    resp = client.get(
        f"/api/projects/{project_id}/export.docx",
        headers=_auth(token),
    )

    assert resp.status_code == 200, resp.text
    assert (
        resp.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert "attachment;" in resp.headers["content-disposition"]
    body = resp.content
    assert body.startswith(b"PK")
    assert b"word/document.xml" in body


def test_export_docx_orders_roots_then_children_then_orphans() -> None:
    graph = GraphOut(
        nodes=[
            _doc_node("orphan", "孤儿节点", parent_id="missing-parent", minutes=0),
            _doc_node("root-a", "根节点 A", minutes=1),
            _doc_node("root-b", "根节点 B", minutes=2),
            _doc_node("child", "子节点 A1", parent_id="root-a", minutes=3),
        ],
        edges=[],
    )

    xml = _docx_document_xml(build_project_docx("排序项目", graph))

    assert xml.index("根节点 A") < xml.index("子节点 A1")
    assert xml.index("子节点 A1") < xml.index("根节点 B")
    assert xml.index("根节点 B") < xml.index("孤儿节点")
