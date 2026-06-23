"""Incremental JSON idea parser.

Parses a streamed ``{"ideas": [ {...}, {...} ]}`` JSON document chunk-by-chunk,
emitting each idea object as soon as it is fully received. This lets the SSE
layer push ideas to the client progressively instead of waiting for the whole
response.

Design:
- ``feed(text_chunk)`` appends to an internal buffer and returns any newly
  completed idea dicts (those containing a ``title``).
- ``finalize()`` does a tolerant full ``json.loads`` of the entire buffer
  (stripping markdown code fences if present) and returns any ideas that were
  not already emitted, as a fallback for providers whose streaming framing the
  incremental scanner could not follow.
- Neither method ever raises on partial/malformed input.

Scanning details:
- We first locate the ``"ideas"`` key and the ``[`` that opens its array.
- From there we scan for balanced top-level ``{...}`` objects, tracking brace
  depth while respecting string literals and backslash escapes (so braces or
  brackets inside strings are ignored).
- When a top-level object closes, we ``json.loads`` it and, if it has a
  ``title``, emit it. We dedupe by the count already emitted, so calling
  ``finalize()`` after streaming will only return ideas beyond what was seen.
"""

from __future__ import annotations

import json
import re
from typing import Any

_IDEAS_KEY_RE = re.compile(r'"ideas"\s*:\s*\[')
_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def _strip_fences(text: str) -> str:
    """Remove a single pair of leading/trailing markdown code fences."""
    out = text.strip()
    if out.startswith("```"):
        # Drop the opening fence line.
        out = re.sub(r"^\s*```(?:json)?\s*\n?", "", out, count=1, flags=re.IGNORECASE)
        # Drop a trailing fence.
        out = re.sub(r"\n?\s*```\s*$", "", out, count=1)
    return out.strip()


def _normalize_idea(obj: dict[str, Any]) -> dict[str, Any]:
    """Coerce a parsed object into the canonical idea shape."""
    title = obj.get("title")
    description = obj.get("description", "") or ""
    tags = obj.get("tags", []) or []
    if not isinstance(tags, list):
        tags = [str(tags)]
    return {
        "title": str(title) if title is not None else "",
        "description": str(description),
        "tags": [str(t) for t in tags],
    }


class IdeaStreamParser:
    """Stateful streaming parser for the ideas JSON array."""

    def __init__(self) -> None:
        self._buffer: str = ""
        self._array_start: int = -1  # index just after the opening '[' of ideas
        self._scan_pos: int = 0  # next index in buffer to scan from
        self._emitted: int = 0  # number of ideas already emitted

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def feed(self, text_chunk: str) -> list[dict[str, Any]]:
        """Append a chunk and return any newly completed idea dicts."""
        if not text_chunk:
            return []
        self._buffer += text_chunk

        if self._array_start < 0:
            self._locate_array()
            if self._array_start < 0:
                return []  # haven't seen the ideas array opener yet

        return self._scan_objects()

    def finalize(self) -> list[dict[str, Any]]:
        """Full tolerant parse of the buffer; return ideas not yet emitted."""
        ideas = self._full_parse()
        if not ideas:
            return []
        remaining = ideas[self._emitted :]
        self._emitted = max(self._emitted, len(ideas))
        return [_normalize_idea(i) for i in remaining if isinstance(i, dict)]

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #
    def _locate_array(self) -> None:
        match = _IDEAS_KEY_RE.search(self._buffer)
        if match:
            self._array_start = match.end()
            self._scan_pos = self._array_start

    def _scan_objects(self) -> list[dict[str, Any]]:
        emitted: list[dict[str, Any]] = []
        buf = self._buffer
        i = self._scan_pos
        n = len(buf)

        while i < n:
            ch = buf[i]
            if ch == "]":
                # End of the ideas array; nothing more to scan.
                self._scan_pos = i
                break
            if ch != "{":
                # Skip whitespace, commas, etc. between objects.
                i += 1
                continue

            # Found an object start; try to find its matching close.
            end = self._find_object_end(buf, i)
            if end is None:
                # Incomplete object; wait for more data. Keep scan pos at this
                # object's start so we retry once more arrives.
                self._scan_pos = i
                return emitted

            obj_text = buf[i : end + 1]
            try:
                obj = json.loads(obj_text)
            except (json.JSONDecodeError, ValueError):
                # Malformed object: skip past it to avoid getting stuck.
                i = end + 1
                self._scan_pos = i
                continue

            if isinstance(obj, dict) and obj.get("title") is not None:
                emitted.append(_normalize_idea(obj))
                self._emitted += 1

            i = end + 1
            self._scan_pos = i

        return emitted

    @staticmethod
    def _find_object_end(buf: str, start: int) -> int | None:
        """Return index of the '}' that closes the object at ``start``.

        Respects string literals and backslash escapes. Returns None if the
        object is not yet complete in the buffer.
        """
        depth = 0
        in_string = False
        escaped = False
        i = start
        n = len(buf)
        while i < n:
            ch = buf[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
            else:
                if ch == '"':
                    in_string = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        return i
            i += 1
        return None

    def _full_parse(self) -> list[Any]:
        """Tolerant whole-buffer parse, returning the ideas list (or [])."""
        text = _strip_fences(self._buffer)
        if not text:
            return []

        # First try: parse the whole thing as an object.
        for candidate in self._candidate_documents(text):
            try:
                data = json.loads(candidate)
            except (json.JSONDecodeError, ValueError):
                continue
            if isinstance(data, dict):
                ideas = data.get("ideas")
                if isinstance(ideas, list):
                    return ideas
            if isinstance(data, list):
                return data
        return []

    @staticmethod
    def _candidate_documents(text: str) -> list[str]:
        """Yield progressively trimmed candidates for a tolerant parse.

        Handles trailing junk by trying the substring up to the last closing
        brace as a fallback.
        """
        candidates = [text]
        last_brace = text.rfind("}")
        if last_brace != -1 and last_brace + 1 < len(text):
            candidates.append(text[: last_brace + 1])
        # Also try from the first '{' to the last '}' to drop leading prose.
        first_brace = text.find("{")
        if first_brace > 0 and last_brace > first_brace:
            candidates.append(text[first_brace : last_brace + 1])
        return candidates
