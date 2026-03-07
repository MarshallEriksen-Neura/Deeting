"""
登录会话管理服务。

职责：
- 登录时记录设备、IP、UA 信息
- 列出 / 注销用户的登录会话
- Token 刷新时更新最近活跃时间
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.login_session import LoginSession
from app.repositories.login_session_repository import LoginSessionRepository

# ---------- UA 解析（轻量级，无额外依赖） ----------

_MOBILE_RE = re.compile(r"Mobile|Android|iPhone|iPad|iPod", re.I)
_TABLET_RE = re.compile(r"iPad|Android(?!.*Mobile)|Tablet", re.I)

_BROWSER_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Edge", re.compile(r"Edg(?:e|A|iOS)?/([\d.]+)")),
    ("Chrome", re.compile(r"Chrome/([\d.]+)")),
    ("Firefox", re.compile(r"Firefox/([\d.]+)")),
    ("Safari", re.compile(r"Version/([\d.]+).*Safari")),
    ("Opera", re.compile(r"OPR/([\d.]+)")),
]

_OS_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Windows", re.compile(r"Windows NT")),
    ("macOS", re.compile(r"Mac OS X")),
    ("Linux", re.compile(r"Linux(?!.*Android)")),
    ("Android", re.compile(r"Android")),
    ("iOS", re.compile(r"iPhone|iPad|iPod")),
]


def _parse_device_type(ua: str) -> str:
    if _TABLET_RE.search(ua):
        return "tablet"
    if _MOBILE_RE.search(ua):
        return "mobile"
    return "desktop"


def _parse_device_name(ua: str) -> str:
    browser = "Unknown Browser"
    for name, pattern in _BROWSER_PATTERNS:
        if pattern.search(ua):
            browser = name
            break

    os_name = "Unknown OS"
    for name, pattern in _OS_PATTERNS:
        if pattern.search(ua):
            os_name = name
            break

    return f"{browser} on {os_name}"


class LoginSessionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = LoginSessionRepository(session)

    async def create_session(
        self,
        *,
        session_key: str,
        user_id: uuid.UUID,
        access_token_jti: str,
        refresh_token_jti: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
        device_type: str | None = None,
        device_name: str | None = None,
    ) -> LoginSession:
        """登录成功后记录会话。"""
        resolved_device_type = device_type or (
            _parse_device_type(user_agent) if user_agent else None
        )
        resolved_device_name = device_name or (
            _parse_device_name(user_agent) if user_agent else None
        )
        return await self.repository.create(
            session_key=session_key,
            user_id=user_id,
            access_token_jti=access_token_jti,
            refresh_token_jti=refresh_token_jti,
            ip_address=ip_address,
            user_agent=user_agent,
            device_type=resolved_device_type,
            device_name=resolved_device_name,
        )

    async def get_session(
        self, *, user_id: uuid.UUID, session_id: uuid.UUID
    ) -> LoginSession | None:
        return await self.repository.get_by_id(user_id=user_id, session_id=session_id)

    async def get_active_session_by_key(
        self, *, session_key: str
    ) -> LoginSession | None:
        return await self.repository.get_active_by_key(session_key=session_key)

    async def list_sessions(self, *, user_id: uuid.UUID) -> list[LoginSession]:
        """列出用户所有活跃会话（未注销）。"""
        return await self.repository.list_active_by_user(user_id=user_id)

    async def rotate_session_tokens(
        self,
        *,
        session_key: str,
        access_token_jti: str,
        refresh_token_jti: str,
    ) -> LoginSession | None:
        return await self.repository.rotate_tokens(
            session_key=session_key,
            access_token_jti=access_token_jti,
            refresh_token_jti=refresh_token_jti,
        )

    async def revoke_session(
        self, *, user_id: uuid.UUID, session_id: uuid.UUID
    ) -> LoginSession | None:
        """注销指定会话。"""
        return await self.repository.revoke(user_id=user_id, session_id=session_id)

    async def revoke_by_session_key(
        self, *, user_id: uuid.UUID, session_key: str
    ) -> LoginSession | None:
        """通过稳定会话键注销会话。"""
        return await self.repository.revoke_by_key(
            user_id=user_id,
            session_key=session_key,
        )

    async def touch_session(self, *, session_key: str) -> None:
        """刷新会话的最近活跃时间。"""
        await self.repository.touch(session_key=session_key)

    async def revoke_all_other_sessions(
        self, *, user_id: uuid.UUID, current_session_key: str
    ) -> int:
        """注销除当前会话以外的所有活跃会话。"""
        return await self.repository.revoke_all_others(
            user_id=user_id,
            current_session_key=current_session_key,
        )


__all__ = ["LoginSessionService"]
