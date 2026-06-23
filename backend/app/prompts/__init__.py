"""Brainstorm mode prompt loader.

Each ``modes/*.yaml`` file defines one brainstorm mode with keys:
``id``, ``name``, ``description``, ``system_prompt``, ``expansion_template``.

``expansion_template`` is a Python ``str.format`` template that may reference
``{node_title}``, ``{node_content}``, ``{context}``, ``{count}`` and
``{instruction}``.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

_MODES_DIR = Path(__file__).resolve().parent / "modes"


@dataclass(frozen=True)
class Mode:
    id: str
    name: str
    description: str
    system_prompt: str
    expansion_template: str

    def public_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "description": self.description}


def _load_modes() -> dict[str, Mode]:
    modes: dict[str, Mode] = {}
    if not _MODES_DIR.exists():
        return modes
    for path in sorted(_MODES_DIR.glob("*.yaml")):
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        mode_id = raw.get("id") or path.stem
        modes[mode_id] = Mode(
            id=mode_id,
            name=raw.get("name", mode_id),
            description=raw.get("description", ""),
            system_prompt=raw.get("system_prompt", ""),
            expansion_template=raw.get("expansion_template", ""),
        )
    return modes


@lru_cache
def get_modes() -> dict[str, Mode]:
    """Cached mapping of ``{mode_id: Mode}``."""
    return _load_modes()


def list_modes() -> list[Mode]:
    """All modes, sorted by id for stable ordering."""
    return [get_modes()[k] for k in sorted(get_modes().keys())]


def get_mode(mode_id: str) -> Mode | None:
    """Look up a mode by id (None if unknown)."""
    return get_modes().get(mode_id)
