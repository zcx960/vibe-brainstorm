"""Share-link and membership management endpoints.

These routes live at explicit paths (no router prefix) so the project-scoped
share/member endpoints and the public accept endpoint can coexist:
  POST   /projects/{project_id}/share              (owner)
  POST   /share/{token}/accept                      (auth)
  GET    /projects/{project_id}/members             (member)
  DELETE /projects/{project_id}/members/{user_id}   (owner)
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Project, ProjectMember, ShareLink, User
from app.permissions import require_role
from app.schemas import MemberOut, MembersOut, ProjectOut, ShareOut, UserOut

router = APIRouter(tags=["share"])


def _is_expired(link: ShareLink) -> bool:
    if link.expires_at is None:
        return False
    expires = link.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires <= datetime.now(timezone.utc)


@router.post("/projects/{project_id}/share", response_model=ShareOut)
async def create_share_link(
    project_id: str,
    access=Depends(require_role("owner")),
    session: AsyncSession = Depends(get_session),
) -> ShareOut:
    # Reuse an existing, non-expired link for this project if present.
    result = await session.execute(
        select(ShareLink).where(ShareLink.project_id == project_id)
    )
    link: ShareLink | None = None
    for candidate in result.scalars().all():
        if not _is_expired(candidate):
            link = candidate
            break

    if link is None:
        link = ShareLink(
            project_id=project_id,
            token=secrets.token_urlsafe(16),
            role="editor",
            created_by=access.user.id,
        )
        session.add(link)
        await session.commit()
        await session.refresh(link)

    return ShareOut(token=link.token, url=f"/?join={link.token}", role=link.role)


@router.post("/share/{token}/accept", response_model=ProjectOut)
async def accept_share_link(
    token: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectOut:
    result = await session.execute(select(ShareLink).where(ShareLink.token == token))
    link = result.scalar_one_or_none()
    if link is None or _is_expired(link):
        raise HTTPException(status_code=404, detail="Share link not found or expired")

    project = await session.get(Project, link.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Share link not found or expired")

    # Idempotent: add membership only if the user is not already a member.
    existing = await session.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == link.project_id,
            ProjectMember.user_id == user.id,
        )
    )
    membership = existing.scalar_one_or_none()
    if membership is None:
        membership = ProjectMember(
            project_id=link.project_id, user_id=user.id, role=link.role
        )
        session.add(membership)
        await session.commit()
        await session.refresh(membership)

    out = ProjectOut.model_validate(project)
    out.role = membership.role
    return out


@router.get("/projects/{project_id}/members", response_model=MembersOut)
async def list_members(
    project_id: str,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
) -> MembersOut:
    result = await session.execute(
        select(ProjectMember, User)
        .join(User, ProjectMember.user_id == User.id)
        .where(ProjectMember.project_id == project_id)
        .order_by(ProjectMember.created_at.asc())
    )
    members = [
        MemberOut(user=UserOut.model_validate(u), role=m.role)
        for m, u in result.all()
    ]
    return MembersOut(members=members)


@router.delete("/projects/{project_id}/members/{user_id}")
async def remove_member(
    project_id: str,
    user_id: str,
    access=Depends(require_role("owner")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    if user_id == access.user.id:
        raise HTTPException(
            status_code=400, detail="Cannot remove yourself via this route"
        )

    result = await session.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if membership.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot remove an owner")

    await session.delete(membership)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
