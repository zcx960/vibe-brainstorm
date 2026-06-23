"""Project membership / role enforcement.

``require_role(min_role)`` returns a FastAPI dependency that:
  - loads the project (404 if missing),
  - loads the caller's ProjectMember row (403 if not a member),
  - checks the role rank meets ``min_role`` (403 otherwise),
and returns an :class:`Access` carrying the user, project, role, and membership.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Project, ProjectMember, User

ROLE_RANK: dict[str, int] = {"editor": 1, "owner": 2}


@dataclass
class Access:
    """Resolved access context returned by ``require_role`` dependencies."""

    user: User
    project: Project
    role: str
    membership: ProjectMember


async def get_role(
    session: AsyncSession, project_id: str, user_id: str
) -> str | None:
    """Return the caller's role on a project, or ``None`` if not a member."""
    result = await session.execute(
        select(ProjectMember.role).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


def require_role(min_role: str):
    """Build a dependency enforcing membership with at least ``min_role``."""
    min_rank = ROLE_RANK[min_role]

    async def dep(
        project_id: str,
        user: User = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> Access:
        project = await session.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")

        result = await session.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user.id,
            )
        )
        membership = result.scalar_one_or_none()
        if membership is None or ROLE_RANK.get(membership.role, 0) < min_rank:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return Access(
            user=user, project=project, role=membership.role, membership=membership
        )

    return dep
