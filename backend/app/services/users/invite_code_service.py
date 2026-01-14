from __future__ import annotations

from datetime import UTC, datetime
from app.utils.time_utils import Datetime
from uuid import UUID

from fastapi import HTTPException, status

from app.core.logging import logger
from app.models import InviteCode, InviteCodeStatus, RegistrationWindow
from app.repositories import InviteCodeRepository
from app.services.users.registration_window_service import (
    RegistrationQuotaExceededError,
    RegistrationWindowClosedError,
    RegistrationWindowNotFoundError,
    claim_registration_slot_for_window,
    rollback_registration_slot,
)


def _now() -> datetime:
    return Datetime.now()


class InviteCodeService:
    def __init__(self, repo: InviteCodeRepository):
        self.repo = repo
        self.session = repo.session

    async def issue(
        self,
        window_id: UUID,
        *,
        count: int,
        length: int = 12,
        prefix: str | None = None,
        expires_at: datetime | None = None,
        note: str | None = None,
    ) -> list[InviteCode]:
        return await self.repo.bulk_create(
            window_id=window_id,
            count=count,
            length=length,
            prefix=prefix,
            expires_at=expires_at,
            note=note,
        )

    async def consume(self, code: str) -> RegistrationWindow:
        """消费邀请码：预占 -> 占用窗口名额 -> 返回窗口配置。

        失败会抛 HTTPException（400/403/410）。
        """
        invite = await self.repo.reserve(code)
        if not invite:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or used invite code")

        # 过期检查
        if invite.expires_at and invite.expires_at < _now():
            await self.repo.revoke(code)
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invite code expired")

        try:
            window = await claim_registration_slot_for_window(self.session, invite.window_id, now=_now())
        except RegistrationWindowNotFoundError as exc:
            await self.repo.rollback(code)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
        except RegistrationWindowClosedError as exc:
            await self.repo.rollback(code)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
        except RegistrationQuotaExceededError as exc:
            await self.repo.rollback(code)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

        # 校验窗口一致性
        if window.id != invite.window_id:
            await rollback_registration_slot(self.session, window.id)
            await self.repo.rollback(code)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite code not valid for current window")

        return window

    async def finalize(self, code: str, user_id: UUID) -> None:
        updated = await self.repo.mark_used(code, user_id)
        if not updated:
            # 极端情况下回滚窗口计数
            logger.warning("invite_mark_used_failed", extra={"code": code, "user_id": str(user_id)})

    async def rollback(self, code: str, window_id: UUID) -> None:
        await self.repo.rollback(code)
        await rollback_registration_slot(self.session, window_id)

    async def revoke(self, code: str) -> InviteCode | None:
        return await self.repo.revoke(code)

    async def list_by_window(self, window_id: UUID, *, status: InviteCodeStatus | None = None, limit: int = 50, offset: int = 0):
        return await self.repo.list_by_window(window_id, status=status, limit=limit, offset=offset)


__all__ = ["InviteCodeService"]
