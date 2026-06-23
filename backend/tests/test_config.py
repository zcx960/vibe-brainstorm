from __future__ import annotations

from pathlib import Path

from app.config import load_providers


def test_load_providers_reads_image_models(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("IMG_KEY", "sk-image")
    providers_file = tmp_path / "providers.yaml"
    providers_file.write_text(
        """
providers:
  - id: imagehub
    name: Image Hub
    base_url: https://image.example.com/v1
    api_key_env: IMG_KEY
    models: [chat-a]
    image_models: [image-a, image-b]
""",
        encoding="utf-8",
    )

    providers = load_providers(providers_file)

    assert len(providers) == 1
    assert providers[0].image_models == ["image-a", "image-b"]
    assert providers[0].api_key == "sk-image"
