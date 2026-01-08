from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.core.logging import logger
from app.core.config import settings
from app.models import Identity, User
from app.repositories import InviteCodeRepository, UserRepository
from app.services.users.invite_code_service import InviteCodeService
from app.services.users.registration_policy import RegistrationPolicy
from app.utils.security import generate_jti, get_password_hash


class UserProvisioningService:
    """
    统一的用户创建/绑定管线：
    - 以邮箱为唯一锚点
    - 新用户时根据策略校验邀请码并占用注册窗口名额
    - OAuth 首次登录与邮箱注册共用同一入口
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.user_repo = UserRepository(db)
        self.policy = RegistrationPolicy()
        self.invite_service = InviteCodeService(InviteCodeRepository(db))

    async def provision_user(
        self,
        *,
        email: str,
        auth_provider: str,
        external_id: str | None = None,
        invite_code: str | None = None,
        username: str | None = None,
        avatar: str | None = None,
        password: str | None = None,
    ) -> User:
        """
        - 如果用户已存在：自动绑定 Identity（如提供），直接返回。
        - 如果是新用户：按策略要求邀请码，消费后创建用户并绑定 Identity。
        """
        if external_id:
            # 先按身份查询，避免同一 provider/sub 重复创建
            by_identity = await self.user_repo.get_by_identity(auth_provider, external_id)
            if by_identity:
                return by_identity

        existing = await self.user_repo.get_by_email(email)
        if existing:
            if external_id and auth_provider:
                await self._ensure_identity(existing.id, auth_provider, external_id, display_name=username)
            return existing

        # 新用户准入检查
        self.policy.ensure_can_register(invite_code=invite_code, provider=auth_provider)

        window = None
        if settings.REGISTRATION_CONTROL_ENABLED:
            # InviteCodeService.consume 会占用对应窗口名额
            window = await self.invite_service.consume(invite_code)  # type: ignore[arg-type]

        is_active = window.auto_activate if window else True
        hashed_password = get_password_hash(password or generate_jti())

        try:
            user = await self.user_repo.create_user(
                email=email,
                hashed_password=hashed_password,
                username=username or email.split("@")[0],
                is_active=is_active,
            )
            await self.db.commit()
            await self.db.refresh(user)
        except Exception:
            await self.db.rollback()
            if window and invite_code:
                await self.invite_service.rollback(invite_code, window.id)
            raise

        # 标记邀请码已使用
        if window and invite_code:
            await self.invite_service.finalize(invite_code, user.id)

        # 绑定 Identity（如有）
        if external_id and auth_provider:
            await self._ensure_identity(user.id, auth_provider, external_id, display_name=username, avatar=avatar)

        logger.info(
            "user_provisioned",
            extra={
                "user_id": str(user.id),
                "provider": auth_provider,
                "invite_used": bool(invite_code),
                "window_id": str(window.id) if window else None,
            },
        )
        return user

    async def _ensure_identity(
        self,
        user_id: UUID,
        provider: str,
        external_id: str,
        *,
        display_name: str | None = None,
        avatar: str | None = None,
    ) -> None:
        # 尝试找到现有绑定
        existing = await self.user_repo.get_by_identity(provider, external_id)
        if existing:
            return

        identity = Identity(
            user_id=user_id,
            provider=provider,
            external_id=external_id,
            display_name=display_name,
        )
        self.db.add(identity)
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            # 可能并发插入同一 identity，忽略
        else:
            logger.info("identity_linked", extra={"user_id": str(user_id), "provider": provider})


__all__ = ["UserProvisioningService"]
