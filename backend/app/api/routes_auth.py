"""Authentication endpoints: register, login, and current-user lookup."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_token, get_current_user, hash_password, pick_color, verify_password
from app.db import get_session
from app.models import User
from app.schemas import AuthOut, LoginIn, RegisterIn, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterIn, session: AsyncSession = Depends(get_session)
) -> AuthOut:
    username = body.username  # already stripped/validated by the schema
    existing = await session.execute(select(User).where(User.username == username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Username already taken")

    display_name = (body.display_name or "").strip() or username
    user = User(
        username=username,
        password_hash=hash_password(body.password),
        display_name=display_name,
        name=display_name,
        color=pick_color(username),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    token = create_token(user.id)
    return AuthOut(token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthOut)
async def login(
    body: LoginIn, session: AsyncSession = Depends(get_session)
) -> AuthOut:
    username = body.username
    result = await session.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_token(user.id)
    return AuthOut(token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
