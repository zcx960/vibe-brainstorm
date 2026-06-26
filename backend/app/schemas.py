"""Pydantic v2 request/response schemas.

Response models mirror the API contract exactly. Timestamps are serialized as
ISO-8601 strings; all IDs are strings.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
class ProviderOut(BaseModel):
    id: str
    name: str
    models: list[str]
    image_models: list[str] = Field(default_factory=list)
    available: bool


class ProvidersOut(BaseModel):
    providers: list[ProviderOut]


class ModeOut(BaseModel):
    id: str
    name: str
    description: str


class ModesOut(BaseModel):
    modes: list[ModeOut]


class DefaultsOut(BaseModel):
    provider: str
    model: str


# --------------------------------------------------------------------------- #
# Projects
# --------------------------------------------------------------------------- #
class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    default_mode: str
    created_at: datetime
    updated_at: datetime
    # The requesting user's role on this project ('owner' | 'editor').
    # Optional so internal validation (e.g. from ORM rows) still succeeds.
    role: str | None = None

    @field_serializer("created_at", "updated_at")
    def _ser_dt(self, value: datetime) -> str:
        return value.isoformat()


class ProjectsOut(BaseModel):
    projects: list[ProjectOut]


class ProjectCreate(BaseModel):
    name: str
    default_mode: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    default_mode: str | None = None


# --------------------------------------------------------------------------- #
# Auth / users
# --------------------------------------------------------------------------- #
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    display_name: str
    color: str


def _validate_username(value: str) -> str:
    """Strip and enforce a 3–32 char username."""
    cleaned = (value or "").strip()
    if len(cleaned) < 3 or len(cleaned) > 32:
        raise ValueError("username must be between 3 and 32 characters")
    return cleaned


class RegisterIn(BaseModel):
    username: str
    password: str
    display_name: str | None = None

    @field_validator("username")
    @classmethod
    def _check_username(cls, value: str) -> str:
        return _validate_username(value)


class LoginIn(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def _check_username(cls, value: str) -> str:
        return _validate_username(value)


class AuthOut(BaseModel):
    token: str
    user: UserOut


# --------------------------------------------------------------------------- #
# Membership / sharing
# --------------------------------------------------------------------------- #
class MemberOut(BaseModel):
    user: UserOut
    role: str


class MembersOut(BaseModel):
    members: list[MemberOut]


class ShareOut(BaseModel):
    token: str
    url: str
    role: str


# --------------------------------------------------------------------------- #
# Graph: nodes + edges
# --------------------------------------------------------------------------- #
class NodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    parent_id: str | None = None
    title: str
    content: str
    data: dict[str, Any]
    created_at: datetime

    @field_serializer("created_at")
    def _ser_dt(self, value: datetime) -> str:
        return value.isoformat()


class EdgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    source_id: str
    target_id: str
    data: dict[str, Any]


class GraphOut(BaseModel):
    nodes: list[NodeOut]
    edges: list[EdgeOut]


class NodeCreate(BaseModel):
    parent_id: str | None = None
    title: str
    content: str | None = None
    data: dict[str, Any] | None = None


class NodeUpdate(BaseModel):
    # Use sentinel-free optionals; only fields explicitly provided are applied.
    model_config = ConfigDict(extra="ignore")

    title: str | None = None
    content: str | None = None
    data: dict[str, Any] | None = None
    parent_id: str | None = None


class EdgeCreate(BaseModel):
    source_id: str
    target_id: str
    data: dict[str, Any] | None = None


# --------------------------------------------------------------------------- #
# Document comments (collaborative annotations)
# --------------------------------------------------------------------------- #
class DocCommentCreate(BaseModel):
    comment_id: str
    quote: str | None = None
    body: str


class DocCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    node_id: str
    comment_id: str
    author_id: str | None = None
    author_name: str
    author_color: str
    quote: str
    body: str
    created_at: datetime

    @field_serializer("created_at")
    def _ser_dt(self, value: datetime) -> str:
        return value.isoformat()


# --------------------------------------------------------------------------- #
# Brainstorm
# --------------------------------------------------------------------------- #
ContextStrategy = Literal["node", "ancestors", "full"]


class ExpandRequest(BaseModel):
    project_id: str
    node_id: str
    mode: str
    provider: str
    model: str
    count: int = Field(default=4, ge=1, le=10)
    instruction: str | None = None
    context_strategy: ContextStrategy = "ancestors"


class ImageGenerateRequest(BaseModel):
    project_id: str
    node_id: str
    provider: str
    model: str
    count: int = Field(default=1, ge=1, le=10)
    prompt: str | None = None
    size: str = "1024x1024"


class Usage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0


class Idea(BaseModel):
    title: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Admin: login + provider management
# --------------------------------------------------------------------------- #
class AdminLoginIn(BaseModel):
    password: str


class AdminTokenOut(BaseModel):
    token: str


class AdminProviderOut(BaseModel):
    """Admin view of a provider. NEVER includes the raw api_key.

    ``has_key`` reports whether a non-empty api_key is stored server-side.
    """

    id: str
    key: str
    name: str
    base_url: str
    models: list[str]
    image_models: list[str] = Field(default_factory=list)
    enabled: bool
    has_key: bool


class AdminProvidersOut(BaseModel):
    providers: list[AdminProviderOut]


class AdminProviderCreate(BaseModel):
    key: str
    name: str
    base_url: str
    api_key: str | None = None
    models: list[str] = Field(default_factory=list)
    image_models: list[str] = Field(default_factory=list)
    enabled: bool = True


class AdminProviderUpdate(BaseModel):
    # Only fields explicitly present in the payload are applied (see route).
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    models: list[str] | None = None
    image_models: list[str] | None = None
    enabled: bool | None = None
