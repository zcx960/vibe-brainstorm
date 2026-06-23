"""Tests for the incremental idea stream parser."""

from __future__ import annotations

import json

from app.llm.json_stream import IdeaStreamParser

IDEAS_DOC = {
    "ideas": [
        {"title": "想法一", "description": "第一个方向，含特殊字符 } 和 \" 引号", "tags": ["a", "b"]},
        {"title": "想法二", "description": "第二个方向", "tags": []},
        {"title": "想法三", "description": "第三个方向 {嵌套花括号}", "tags": ["x"]},
    ]
}
DOC_STR = json.dumps(IDEAS_DOC, ensure_ascii=False)


def _chunk(text: str, sizes: list[int]) -> list[str]:
    """Split text into chunks of the given sizes (last chunk gets the rest)."""
    chunks: list[str] = []
    i = 0
    for size in sizes:
        chunks.append(text[i : i + size])
        i += size
    if i < len(text):
        chunks.append(text[i:])
    return chunks


def _titles(ideas: list[dict]) -> list[str]:
    return [i["title"] for i in ideas]


def test_recovers_all_ideas_single_chunk() -> None:
    parser = IdeaStreamParser()
    out = parser.feed(DOC_STR)
    out += parser.finalize()
    assert _titles(out) == ["想法一", "想法二", "想法三"]
    # Descriptions and tags preserved exactly.
    assert out[0]["description"] == IDEAS_DOC["ideas"][0]["description"]
    assert out[0]["tags"] == ["a", "b"]
    assert out[1]["tags"] == []


def test_recovers_all_ideas_byte_by_byte() -> None:
    parser = IdeaStreamParser()
    collected: list[dict] = []
    for ch in DOC_STR:  # one character at a time — most adversarial split
        collected += parser.feed(ch)
    collected += parser.finalize()
    assert _titles(collected) == ["想法一", "想法二", "想法三"]


def test_recovers_all_ideas_arbitrary_splits() -> None:
    for sizes in ([1, 2, 3, 5, 8, 13], [10, 1, 50, 2], [7, 7, 7, 7, 7, 7, 7]):
        parser = IdeaStreamParser()
        collected: list[dict] = []
        for chunk in _chunk(DOC_STR, sizes):
            result = parser.feed(chunk)
            assert isinstance(result, list)  # never raises, always a list
            collected += result
        collected += parser.finalize()
        assert _titles(collected) == ["想法一", "想法二", "想法三"], sizes


def test_each_idea_emitted_exactly_once() -> None:
    parser = IdeaStreamParser()
    collected: list[dict] = []
    for chunk in _chunk(DOC_STR, [20, 20, 20, 20]):
        collected += parser.feed(chunk)
    # finalize should NOT re-emit anything already streamed.
    extra = parser.finalize()
    assert extra == []
    assert len(collected) == 3
    assert _titles(collected) == ["想法一", "想法二", "想法三"]


def test_partial_input_never_raises() -> None:
    parser = IdeaStreamParser()
    # Feed only a truncated prefix; must not raise, must emit nothing complete.
    prefix = DOC_STR[: len(DOC_STR) // 2]
    out = parser.feed(prefix)
    assert isinstance(out, list)
    # Whatever completed so far is a subset, in order, of the full set.
    assert _titles(out) == ["想法一", "想法二", "想法三"][: len(out)]


def test_markdown_fenced_finalize() -> None:
    fenced = "```json\n" + DOC_STR + "\n```"
    parser = IdeaStreamParser()
    # Streaming scanner may pick some up, but finalize must recover the full set.
    collected = parser.feed(fenced)
    collected += parser.finalize()
    assert _titles(collected) == ["想法一", "想法二", "想法三"]


def test_fenced_with_trailing_fence_does_not_break_scan() -> None:
    # The closing ``` after the JSON must not corrupt incremental scanning of
    # the final object; feed+finalize together recover the full set exactly once.
    fenced = "```\n" + DOC_STR + "\n```"
    parser = IdeaStreamParser()
    collected = parser.feed(fenced)
    collected += parser.finalize()
    assert _titles(collected) == ["想法一", "想法二", "想法三"]


def test_finalize_does_not_duplicate_after_full_stream() -> None:
    # After feed() has emitted every idea, finalize() must return nothing extra
    # (no duplicates), regardless of how the doc arrived.
    parser = IdeaStreamParser()
    streamed: list[dict] = []
    streamed += parser.feed("前置噪声，无 ideas 键。")  # scanner idle
    streamed += parser.feed(DOC_STR)  # now the array appears and ideas stream
    leftover = parser.finalize()
    all_titles = _titles(streamed) + _titles(leftover)
    # Exactly three, each once, in order.
    assert all_titles == ["想法一", "想法二", "想法三"]


def test_leading_prose_then_json() -> None:
    noisy = "好的，这是结果：\n" + DOC_STR
    parser = IdeaStreamParser()
    collected = parser.feed(noisy)
    collected += parser.finalize()
    assert _titles(collected) == ["想法一", "想法二", "想法三"]
