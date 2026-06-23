"""Project CRUD endpoints (membership-scoped)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Project, ProjectMember, User
from app.permissions import require_role
from app.realtime import manager
from app.schemas import ProjectCreate, ProjectOut, ProjectsOut, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


def _project_out(project: Project, role: str | None) -> ProjectOut:
    out = ProjectOut.model_validate(project)
    out.role = role
    return out


def _project_payload(project: Project) -> dict:
    """Serialize a project to the realtime ``project.updated`` payload shape.

    Reuses ProjectOut's ISO-8601 datetime serializers, then drops ``role``
    (which is per-requester and not part of the broadcast contract).
    """
    data = ProjectOut.model_validate(project).model_dump(mode="json")
    data.pop("role", None)
    return data


@router.get("", response_model=ProjectsOut)
async def list_projects(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectsOut:
    result = await session.execute(
        select(Project, ProjectMember.role)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user.id)
        .order_by(Project.created_at.desc())
    )
    projects = [_project_out(p, role) for p, role in result.all()]
    return ProjectsOut(projects=projects)


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectOut:
    project = Project(
        user_id=user.id,
        name=body.name,
        default_mode=body.default_mode or "general",
    )
    session.add(project)
    await session.flush()  # assign project.id
    session.add(
        ProjectMember(project_id=project.id, user_id=user.id, role="owner")
    )
    await session.commit()
    await session.refresh(project)
    return _project_out(project, "owner")


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    access=Depends(require_role("editor")),
) -> ProjectOut:
    return _project_out(access.project, access.role)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    access=Depends(require_role("editor")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> ProjectOut:
    project = access.project
    if body.name is not None:
        project.name = body.name
    if body.default_mode is not None:
        project.default_mode = body.default_mode
    await session.commit()
    await session.refresh(project)
    await manager.broadcast(
        project_id,
        {
            "type": "project.updated",
            "origin": x_client_id,
            "payload": {"project": _project_payload(project)},
        },
        exclude_client=x_client_id,
    )
    return _project_out(project, access.role)


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    access=Depends(require_role("owner")),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
) -> Response:
    deleted_id = access.project.id  # capture before deletion
    await session.delete(access.project)
    await session.commit()
    await manager.broadcast(
        project_id,
        {
            "type": "project.deleted",
            "origin": x_client_id,
            "payload": {"project_id": deleted_id},
        },
        exclude_client=x_client_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
