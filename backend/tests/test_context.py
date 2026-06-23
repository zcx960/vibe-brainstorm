"""Tests for the ancestor-path context builder using an in-memory SQLite DB.

These tests also exercise that the ORM models (portable String UUID PKs + JSON
columns) work on SQLite, which is the whole point of the portable types.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import DEFAULT_USER_ID, Node, Project, User
from app.services.context import build_context


@pytest_asyncio.fixture
async def session():
    # In-memory SQLite with a single shared connection so the schema persists
    # for the lifetime of the test.
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    async with maker() as s:
        yield s

    await engine.dispose()


async def _make_tree(session) -> tuple[Node, Node, Node, Project]:
    """root -> child -> grandchild; returns (root, child, grandchild, project)."""
    session.add(
        User(
            id=DEFAULT_USER_ID,
            username="default",
            password_hash="x",
            display_name="default",
            color="#6366f1",
            name="default",
        )
    )
    project = Project(user_id=DEFAULT_USER_ID, name="测试项目")
    session.add(project)
    await session.flush()

    root = Node(
        project_id=project.id,
        parent_id=None,
        title="根节点",
        content="这是根节点的内容",
        data={"position": {"x": 0.0, "y": 0.0}},
    )
    session.add(root)
    await session.flush()

    child = Node(
        project_id=project.id,
        parent_id=root.id,
        title="子节点",
        content="这是子节点",
        data={"position": {"x": 100.0, "y": 180.0}},
    )
    session.add(child)
    await session.flush()

    grandchild = Node(
        project_id=project.id,
        parent_id=child.id,
        title="孙节点",
        content="这是孙节点",
        data={"position": {"x": 200.0, "y": 360.0}},
    )
    session.add(grandchild)
    await session.commit()

    return root, child, grandchild, project


@pytest.mark.asyncio
async def test_ancestors_contains_all_titles_in_order(session) -> None:
    root, child, grandchild, _ = await _make_tree(session)

    ctx = await build_context(session, grandchild, "ancestors")

    # All three titles present.
    assert "根节点" in ctx
    assert "子节点" in ctx
    assert "孙节点" in ctx

    # Order: root before child before grandchild.
    assert ctx.index("根节点") < ctx.index("子节点") < ctx.index("孙节点")


@pytest.mark.asyncio
async def test_node_strategy_only_leaf(session) -> None:
    root, child, grandchild, _ = await _make_tree(session)

    ctx = await build_context(session, grandchild, "node")

    assert "孙节点" in ctx
    assert "根节点" not in ctx
    assert "子节点" not in ctx


@pytest.mark.asyncio
async def test_full_strategy_lists_all_nodes(session) -> None:
    root, child, grandchild, _ = await _make_tree(session)

    ctx = await build_context(session, child, "full")

    # Full outline should mention every node title in the project.
    assert "根节点" in ctx
    assert "子节点" in ctx
    assert "孙节点" in ctx


@pytest.mark.asyncio
async def test_ancestors_on_root_is_just_root(session) -> None:
    root, child, grandchild, _ = await _make_tree(session)

    ctx = await build_context(session, root, "ancestors")

    assert "根节点" in ctx
    assert "子节点" not in ctx
    assert "孙节点" not in ctx
