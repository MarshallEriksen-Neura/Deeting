from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Iterable
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import InviteCode, InviteCodeStatus


def _now() -> datetime:
    return datetime.now(UTC)


def _generate_code(length: int = 12, prefix: str | None = None) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 去除易混字符
    body = "".join(secrets.choice(alphabet) for _ in range(length))
    return f"{prefix}{body}" if prefix else body


class InviteCodeRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def bulk_create(
        self,
        *,
        window_id: UUID,
        count: int,
        length: int = 12,
        prefix: str | None = None,
        expires_at: datetime | None = None,
        note: str | None = None,
    ) -> list[InviteCode]:
        codes: list[InviteCode] = []
        for _ in range(count):
            code = _generate_code(length=length, prefix=prefix)
            invite = InviteCode(
                code=code,
                window_id=window_id,
                status=InviteCodeStatus.UNUSED,
                expires_at=expires_at,
                note=note,
            )
            self.session.add(invite)
            codes.append(invite)
        await self.session.commit()
        for invite in codes:
            await self.session.refresh(invite)
        return codes

    async def get_by_code(self, code: str) -> InviteCode | None:
        res = await self.session.execute(select(InviteCode).where(InviteCode.code == code))
        return res.scalar_one_or_none()

    async def reserve(self, code: str) -> InviteCode | None:
        """预占邀请码，防止并发重复消费。"""
        stmt = (
            update(InviteCode)
            .where(InviteCode.code == code)
            .where(InviteCode.status == InviteCodeStatus.UNUSED)
            .values(status=InviteCodeStatus.RESERVED, reserved_at=_now())
            .returning(InviteCode)
        )
        res = await self.session.execute(stmt)
        invite = res.scalar_one_or_none()
        if invite:
            await self.session.commit()
        return invite

    async def mark_used(self, code: str, user_id: UUID) -> InviteCode | None:
        stmt = (
            update(InviteCode)
            .where(InviteCode.code == code)
            .where(InviteCode.status == InviteCodeStatus.RESERVED)
            .values(status=InviteCodeStatus.USED, used_at=_now(), used_by=user_id)
            .returning(InviteCode)
        )
        res = await self.session.execute(stmt)
        invite = res.scalar_one_or_none()
        if invite:
            await self.session.commit()
        return invite

    async def rollback(self, code: str) -> None:
        stmt = (
            update(InviteCode)
            .where(InviteCode.code == code)
            .where(InviteCode.status == InviteCodeStatus.RESERVED)
            .values(status=InviteCodeStatus.UNUSED, reserved_at=None)
        )
        await self.session.execute(stmt)
        await self.session.commit()

    async def revoke(self, code: str) -> InviteCode | None:
        stmt = (
            update(InviteCode)
            .where(InviteCode.code == code)
            .where(InviteCode.status.in_([InviteCodeStatus.UNUSED, InviteCodeStatus.RESERVED]))
            .values(status=InviteCodeStatus.REVOKED)
            .returning(InviteCode)
        )
        res = await self.session.execute(stmt)
        invite = res.scalar_one_or_none()
        if invite:
            await self.session.commit()
        return invite

    async def list_by_window(
        self,
        window_id: UUID,
        *,
        status: InviteCodeStatus | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[InviteCode], int]:
        query = select(InviteCode).where(InviteCode.window_id == window_id)
        if status:
            query = query.where(InviteCode.status == status)
        total_res = await self.session.execute(query.with_only_columns(InviteCode.id))
        total = len(total_res.scalars().all())
        res = await self.session.execute(query.order_by(InviteCode.created_at.desc()).limit(limit).offset(offset))
        return res.scalars().all(), total


__all__ = ["InviteCodeRepository"]
