"""
登录会话管理 API (/api/v1/login-sessions)

端点:
- GET  /login-sessions        — 列出当前用户的活跃登录会话
- DELETE /login-sessions/{id} — 注销指定登录会话
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_active_user
from app.models import User
from app.services.users.login_session_service import LoginSessionService
from app.utils.security import decode_token

router = APIRouter(prefix="/login-sessions", tags=["Login Sessions"])

REFRESH_COOKIE_NAME = "refresh_token"


class LoginSessionItem(BaseModel):
    id: uuid.UUID = Field(..., description="会话 ID")
    ip_address: str | None = Field(None, description="登录 IP")
    device_type: str | None = Field(None, description="设备类型")
    device_name: str | None = Field(None, description="设备描述")
    last_active_at: datetime = Field(..., description="最近活跃时间")
    created_at: datetime = Field(..., description="登录时间")
    is_current: bool = Field(False, description="是否为当前会话")


def _extract_refresh_jti(cookie_value: str | None) -> str | None:
    """从 refresh token cookie 中提取 jti。"""
    if not cookie_value:
        return None
    token = cookie_value.strip()
    if token.startswith(f"{REFRESH_COOKIE_NAME}="):
        token = token[len(f"{REFRESH_COOKIE_NAME}="):]
    if ";" in token:
        token = token.split(";", 1)[0].strip()
    if not token:
        return None
    try:
        payload = decode_token(token)
        return payload.get("jti")
    except (ValueError, Exception):
        return None


@router.get("", response_model=list[LoginSessionItem])
async def list_login_sessions(
    user: User = Depends(get_current_active_user),
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """列出当前用户的所有活跃登录会话。"""
    service = LoginSessionService(db)
    sessions = await service.list_sessions(user_id=user.id)
    current_jti = _extract_refresh_jti(refresh_cookie)

    return [
        {
            "id": s.id,
            "ip_address": s.ip_address,
            "device_type": s.device_type,
            "device_name": s.device_name,
            "last_active_at": s.last_active_at,
            "created_at": s.created_at,
            "is_current": (
                current_jti is not None and s.refresh_token_jti == current_jti
            ),
        }
        for s in sessions
    ]


@router.delete("/{session_id}")
async def revoke_login_session(
    session_id: uuid.UUID,
    user: User = Depends(get_current_active_user),
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """注销指定的登录会话（不允许注销当前会话）。"""
    # 检查是否尝试注销当前会话
    service = LoginSessionService(db)

    current_jti = _extract_refresh_jti(refresh_cookie)
    if current_jti:
        from sqlalchemy import select
        from app.models.login_session import LoginSession

        stmt = select(LoginSession).where(
            LoginSession.id == session_id,
            LoginSession.user_id == user.id,
        )
        result = await db.execute(stmt)
        target = result.scalars().first()
        if target and target.refresh_token_jti == current_jti:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot revoke current session, use logout instead",
            )

    success = await service.revoke_session(user_id=user.id, session_id=session_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )
    await db.commit()
    return {"message": "Session revoked"}
