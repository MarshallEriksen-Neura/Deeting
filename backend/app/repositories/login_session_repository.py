from __future__ import annotations

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.login_session import LoginSession
from app.utils.time_utils import Datetime


class LoginSessionRepository:
    """登录会话仓库，封装 LoginSession 的持久化访问。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
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
        record = LoginSession(
            session_key=session_key,
            user_id=user_id,
            current_access_jti=access_token_jti,
            current_refresh_jti=refresh_token_jti,
            ip_address=ip_address,
            user_agent=user_agent,
            device_type=device_type,
            device_name=device_name,
            last_active_at=Datetime.now(),
        )
        self.session.add(record)
        await self.session.flush()
        return record

    async def get_by_id(
        self, *, user_id: uuid.UUID, session_id: uuid.UUID
    ) -> LoginSession | None:
        stmt = select(LoginSession).where(
            LoginSession.id == session_id,
            LoginSession.user_id == user_id,
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_active_by_key(self, *, session_key: str) -> LoginSession | None:
        stmt = select(LoginSession).where(
            LoginSession.session_key == session_key,
            LoginSession.revoked_at.is_(None),
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def list_active_by_user(self, *, user_id: uuid.UUID) -> list[LoginSession]:
        stmt = (
            select(LoginSession)
            .where(
                LoginSession.user_id == user_id,
                LoginSession.revoked_at.is_(None),
            )
            .order_by(LoginSession.last_active_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def rotate_tokens(
        self,
        *,
        session_key: str,
        access_token_jti: str,
        refresh_token_jti: str,
    ) -> LoginSession | None:
        record = await self.get_active_by_key(session_key=session_key)
        if record is None:
            return None

        record.current_access_jti = access_token_jti
        record.current_refresh_jti = refresh_token_jti
        record.last_active_at = Datetime.now()
        self.session.add(record)
        await self.session.flush()
        return record

    async def revoke(
        self, *, user_id: uuid.UUID, session_id: uuid.UUID
    ) -> LoginSession | None:
        record = await self.get_by_id(user_id=user_id, session_id=session_id)
        if record is None or record.revoked_at is not None:
            return None

        record.revoked_at = Datetime.now()
        self.session.add(record)
        await self.session.flush()
        return record

    async def revoke_by_key(
        self, *, user_id: uuid.UUID, session_key: str
    ) -> LoginSession | None:
        stmt = select(LoginSession).where(
            LoginSession.user_id == user_id,
            LoginSession.session_key == session_key,
            LoginSession.revoked_at.is_(None),
        )
        result = await self.session.execute(stmt)
        record = result.scalars().first()
        if record is None:
            return None

        record.revoked_at = Datetime.now()
        self.session.add(record)
        await self.session.flush()
        return record

    async def touch(self, *, session_key: str) -> None:
        stmt = (
            update(LoginSession)
            .where(
                LoginSession.session_key == session_key,
                LoginSession.revoked_at.is_(None),
            )
            .values(last_active_at=Datetime.now())
        )
        await self.session.execute(stmt)

    async def revoke_all_others(
        self, *, user_id: uuid.UUID, current_session_key: str
    ) -> int:
        stmt = (
            update(LoginSession)
            .where(
                LoginSession.user_id == user_id,
                LoginSession.session_key != current_session_key,
                LoginSession.revoked_at.is_(None),
            )
            .values(revoked_at=Datetime.now())
        )
        result = await self.session.execute(stmt)
        return result.rowcount or 0
