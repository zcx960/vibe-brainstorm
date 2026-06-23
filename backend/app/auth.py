"""Authentication primitives: password hashing, JWT, color assignment, and the
``get_current_user`` FastAPI dependency.

- Passwords are hashed with bcrypt via passlib.
- Tokens are HS256 JWTs (pyjwt) carrying ``sub`` (user id) and ``exp``.
- A small fixed palette assigns each user a stable hex color, derived from a
  hash of the username (deterministic, never ``random``).
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException, status
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import User

# --------------------------------------------------------------------------- #
# Password hashing
# --------------------------------------------------------------------------- #
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt."""
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a plaintext password against a stored bcrypt hash."""
    try:
        return _pwd_context.verify(password, password_hash)
    except Exception:  # noqa: BLE001 - malformed hash -> not a match
        return False


# --------------------------------------------------------------------------- #
# Color palette
# --------------------------------------------------------------------------- #
COLOR_PALETTE: list[str] = [
    "#6366f1",  # indigo
    "#ec4899",  # pink
    "#f59e0b",  # amber
    "#10b981",  # emerald
    "#3b82f6",  # blue
    "#ef4444",  # red
    "#8b5cf6",  # violet
    "#14b8a6",  # teal
    "#f97316",  # orange
    "#06b6d4",  # cyan
]


def pick_color(seed: str) -> str:
    """Deterministically pick a palette color from a seed (e.g. a username).

    Uses a stable hash of the seed so the same user always gets the same color;
    never uses randomness.
    """
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    index = int(digest, 16) % len(COLOR_PALETTE)
    return COLOR_PALETTE[index]


# --------------------------------------------------------------------------- #
# JWT
# --------------------------------------------------------------------------- #
def create_token(user_id: str) -> str:
    """Create a signed JWT for ``user_id`` (claims: sub, exp)."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "exp": now + timedelta(days=settings.jwt_expire_days),
        "iat": now,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> str | None:
    """Decode a JWT and return its ``sub`` (user id), or ``None`` if invalid."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) else None


def _extract_bearer(authorization: str | None) -> str | None:
    """Pull the bearer token out of an ``Authorization`` header value."""
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


async def get_user_from_token(session: AsyncSession, token: str | None) -> User | None:
    """Resolve a ``User`` from a raw token (no header parsing).

    Reused by WebSocket auth in a later phase. Returns ``None`` if the token is
    missing/invalid or the user no longer exists.
    """
    if not token:
        return None
    user_id = decode_token(token)
    if user_id is None:
        return None
    return await session.get(User, user_id)


async def get_current_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User:
    """FastAPI dependency: authenticate via ``Authorization: Bearer <token>``.

    Raises 401 if the header is missing, malformed, the token is invalid, or the
    user does not exist.
    """
    token = _extract_bearer(authorization)
    user = await get_user_from_token(session, token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


# --------------------------------------------------------------------------- #
# Admin auth (a single shared password, NOT a user account)
# --------------------------------------------------------------------------- #
def create_admin_token() -> str:
    """Create a signed admin JWT (claims: role="admin", exp, iat).

    Carries no ``sub`` — admin access is role-based, not tied to a user row.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "role": "admin",
        "exp": now + timedelta(days=settings.jwt_expire_days),
        "iat": now,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_admin_token(token: str | None) -> bool:
    """Return True iff ``token`` is a valid admin JWT (role == "admin")."""
    if not token:
        return False
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return False
    return payload.get("role") == "admin"


async def require_admin(
    authorization: str | None = Header(default=None),
) -> bool:
    """FastAPI dependency: authorize admin via ``Authorization: Bearer <token>``.

    Raises 401 unless the bearer token decodes with ``role == "admin"``.
    """
    token = _extract_bearer(authorization)
    if not decode_admin_token(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True
