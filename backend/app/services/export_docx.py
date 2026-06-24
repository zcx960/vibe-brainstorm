from __future__ import annotations

import html
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.schemas import EdgeOut, GraphOut, NodeOut

EMU_PER_INCH = 914400
DOC_IMAGE_WIDTH_EMU = int(5.4 * EMU_PER_INCH)
DOC_IMAGE_HEIGHT_EMU = int(3.2 * EMU_PER_INCH)


@dataclass(frozen=True, slots=True)
class DocxImage:
    rel_id: str
    filename: str
    content_type: str
    data: bytes


def build_project_docx(project_name: str, graph: GraphOut) -> bytes:
    images: list[DocxImage] = []
    image_lookup: dict[str, DocxImage] = {}
    body_parts = [
        _paragraph(project_name or "未命名项目", bold=True, size=32),
        _paragraph(""),
    ]

    for depth, node in _ordered_nodes(graph):
        title = node.title or "未命名"
        body_parts.append(_paragraph(f"{'  ' * depth}{title}", bold=True, size=26))
        if node.content:
            body_parts.append(_paragraph(node.content, size=22))

        image = _image_for_node(node, images, image_lookup)
        if image is not None:
            body_parts.append(_image_paragraph(image.rel_id))
        else:
            image_url = _image_url(node)
            if image_url:
                body_parts.append(_paragraph(f"图片：{image_url}", size=20))
        body_parts.append(_paragraph(""))

    document_xml = _document_xml("\n".join(body_parts))
    rels_xml = _document_relationships_xml(images)

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", _content_types_xml(images))
        zf.writestr("_rels/.rels", _root_relationships_xml())
        zf.writestr("word/document.xml", document_xml)
        zf.writestr("word/_rels/document.xml.rels", rels_xml)
        for image in images:
            zf.writestr(f"word/media/{image.filename}", image.data)
    return buffer.getvalue()


def _ordered_nodes(graph: GraphOut) -> list[tuple[int, NodeOut]]:
    nodes = sorted(graph.nodes, key=lambda n: n.created_at)
    by_id = {node.id: node for node in nodes}
    children: dict[str | None, list[NodeOut]] = {}
    roots: list[NodeOut] = []
    orphans: list[NodeOut] = []

    for node in nodes:
        if node.parent_id is None:
            roots.append(node)
        elif node.parent_id not in by_id:
            orphans.append(node)
        else:
            children.setdefault(node.parent_id, []).append(node)

    for child_list in children.values():
        child_list.sort(key=lambda n: n.created_at)

    ordered: list[tuple[int, NodeOut]] = []
    seen: set[str] = set()

    def visit(node: NodeOut, depth: int) -> None:
        if node.id in seen:
            return
        seen.add(node.id)
        ordered.append((depth, node))
        for child in children.get(node.id, []):
            visit(child, depth + 1)

    for root in roots:
        visit(root, 0)

    for orphan in orphans:
        visit(orphan, 0)

    for node in nodes:
        visit(node, 0)

    return ordered


def _image_for_node(
    node: NodeOut,
    images: list[DocxImage],
    image_lookup: dict[str, DocxImage],
) -> DocxImage | None:
    path = _image_path(node)
    if path is None or not path.is_file():
        return None
    key = str(path)
    existing = image_lookup.get(key)
    if existing is not None:
        return existing

    content_type, ext = _image_type(path)
    rel_id = f"rIdImage{len(images) + 1}"
    image = DocxImage(
        rel_id=rel_id,
        filename=f"image{len(images) + 1}{ext}",
        content_type=content_type,
        data=path.read_bytes(),
    )
    images.append(image)
    image_lookup[key] = image
    return image


def _image_url(node: NodeOut) -> str | None:
    value = node.data.get("image_url") if isinstance(node.data, dict) else None
    return value if isinstance(value, str) and value else None


def _image_path(node: NodeOut) -> Path | None:
    if not isinstance(node.data, dict):
        return None

    media_path = node.data.get("media_path")
    if isinstance(media_path, str) and media_path:
        return Path(media_path)

    image_url = _image_url(node)
    if not image_url or not image_url.startswith("/api/media/"):
        return None

    relative = image_url.removeprefix("/api/media/").lstrip("/")
    root = Path(get_settings().media_dir).resolve()
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate


def _image_type(path: Path) -> tuple[str, str]:
    ext = path.suffix.lower()
    if ext in {".jpg", ".jpeg"}:
        return "image/jpeg", ".jpg"
    if ext == ".gif":
        return "image/gif", ".gif"
    if ext == ".webp":
        return "image/webp", ".webp"
    return "image/png", ".png"


def _xml(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _paragraph(text: str, *, bold: bool = False, size: int = 22) -> str:
    properties = f"<w:sz w:val=\"{size}\"/>"
    if bold:
        properties = "<w:b/>" + properties
    return (
        "<w:p><w:r><w:rPr>"
        f"{properties}"
        "</w:rPr><w:t xml:space=\"preserve\">"
        f"{_xml(text)}"
        "</w:t></w:r></w:p>"
    )


def _image_paragraph(rel_id: str) -> str:
    return f"""
<w:p>
  <w:r>
    <w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="{DOC_IMAGE_WIDTH_EMU}" cy="{DOC_IMAGE_HEIGHT_EMU}"/>
        <wp:docPr id="1" name="Picture"/>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic>
              <pic:nvPicPr>
                <pic:cNvPr id="0" name="image"/>
                <pic:cNvPicPr/>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="{rel_id}"/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm>
                  <a:off x="0" y="0"/>
                  <a:ext cx="{DOC_IMAGE_WIDTH_EMU}" cy="{DOC_IMAGE_HEIGHT_EMU}"/>
                </a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>
"""


def _document_xml(body: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    {body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>
"""


def _root_relationships_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>
"""


def _document_relationships_xml(images: list[DocxImage]) -> str:
    image_rels = "\n".join(
        (
            f'<Relationship Id="{image.rel_id}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
            f'Target="media/{image.filename}"/>'
        )
        for image in images
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{image_rels}
</Relationships>
"""


def _content_types_xml(images: list[DocxImage]) -> str:
    defaults = {
        "rels": "application/vnd.openxmlformats-package.relationships+xml",
        "xml": "application/xml",
    }
    for image in images:
        ext = image.filename.rsplit(".", 1)[-1]
        defaults.setdefault(ext, image.content_type)
    default_xml = "\n".join(
        f'<Default Extension="{_xml(ext)}" ContentType="{_xml(content_type)}"/>'
        for ext, content_type in defaults.items()
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  {default_xml}
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""
