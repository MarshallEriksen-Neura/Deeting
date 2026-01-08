"""
认证服务：JWT 登录/登出/刷新、Token 黑名单、登录限流、验证码
"""
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.core.logging import logger
from app.models import User
from app.repositories import UserRepository
from app.repositories.api_key import ApiKeyRepository
from app.schemas.auth import TokenPair
from app.services.api_key import ApiKeyService
from app.services.users.user_provisioning_service import UserProvisioningService
from app.utils.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_jti,
    generate_verification_code,
    get_password_hash,
    verify_password,
)


class AuthService:
    """认证服务"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.user_repo = UserRepository(db)
        self.provisioner = UserProvisioningService(db)

    # ========== 登录相关 ==========

    async def login(self, email: str, password: str) -> TokenPair:
        """
        完整登录流程

        - 检查登录限流
        - 验证凭据
        - 处理登录失败计数
        - 创建 token
        """
        # 检查登录限流
        await self.check_login_rate_limit(email)

        try:
            # 验证凭据
            user = await self.verify_credentials(email, password)

            # 重置登录失败计数
            await self.reset_login_failures(email)

            # 创建 token
            tokens = await self.create_tokens(user)

            logger.info(
                "login_success",
                extra={"user_id": str(user.id), "email": user.email},
            )

            return tokens

        except HTTPException as e:
            if e.status_code == status.HTTP_401_UNAUTHORIZED:
                # 记录登录失败
                await self.increment_login_failure(email)
            raise

    async def verify_credentials(self, email: str, password: str) -> User:
        """验证用户凭据；不再在登录时自动注册新用户。"""
        user = await self.user_repo.get_by_email(email)

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Account not found",
            )

        if not verify_password(password, user.hashed_password):
            logger.warning("login_failed", extra={"email": email, "reason": "invalid_password"})
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )

        if not user.is_active:
            if settings.REGISTRATION_CONTROL_ENABLED:
                logger.warning("login_failed", extra={"email": email, "reason": "user_inactive"})
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Account is not activated",
                )
            user.is_active = True
            await self.db.flush()
            await self.db.refresh(user)
            logger.info("user_auto_activated", extra={"user_id": str(user.id), "email": email})

        return user


    async def create_tokens(self, user: User) -> TokenPair:
        """为用户创建 token 对"""
        access_jti = generate_jti()
        refresh_jti = generate_jti()

        access_token = create_access_token(user.id, access_jti, user.token_version)
        refresh_token = create_refresh_token(user.id, refresh_jti, user.token_version)

        # 存储 refresh token 到 Redis (用于轮换验证)
        refresh_key = f"auth:refresh:{refresh_jti}"
        refresh_data = {
            "user_id": str(user.id),
            "version": user.token_version,
            "used": False,
        }
        await cache.set(
            refresh_key,
            refresh_data,
            ttl=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        )

        logger.info("tokens_created", extra={"user_id": str(user.id), "access_jti": access_jti})

        return TokenPair(access_token=access_token, refresh_token=refresh_token)

    async def refresh_tokens(self, refresh_token: str) -> TokenPair:
        """刷新 token（实现轮换策略）"""
        try:
            payload = decode_token(refresh_token)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid refresh token: {e}",
            )

        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
            )

        jti = payload.get("jti")
        user_id = UUID(payload.get("sub"))
        token_version = payload.get("version", 0)

        # 检查 refresh token 是否已使用（轮换策略）
        refresh_key = f"auth:refresh:{jti}"
        refresh_data = await cache.get(refresh_key)

        if not refresh_data:
            logger.warning("refresh_token_not_found", extra={"jti": jti})
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token expired or invalid",
            )

        if refresh_data.get("used"):
            # 检测到 token 重用，可能是攻击，撤销所有 token
            logger.warning("refresh_token_reuse_detected", extra={"user_id": str(user_id), "jti": jti})
            await self.revoke_all_tokens(user_id)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token reuse detected, all sessions invalidated",
            )

        # 标记旧 refresh token 为已使用
        refresh_data["used"] = True
        await cache.set(refresh_key, refresh_data, ttl=60)  # 短 TTL，防止重放

        # 验证用户和 token 版本
        user = await self.user_repo.get_by_id(user_id)
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
            )

        # 封禁检查
        ban_key = f"auth:ban:{user.id}"
        if await cache.get(ban_key):
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail="Account is banned",
            )

        if user.token_version != token_version:
            logger.warning("token_version_mismatch", extra={"user_id": str(user_id)})
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token version mismatch, please login again",
            )

        # 创建新的 token 对
        return await self.create_tokens(user)

    async def logout(self, access_jti: str, refresh_jti: str | None = None) -> None:
        """登出：将 token 加入黑名单"""
        # 将 access token 加入黑名单
        blacklist_key = f"auth:access:{access_jti}"
        await cache.set(
            blacklist_key,
            {"revoked": True},
            ttl=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        )

        # 删除 refresh token
        if refresh_jti:
            refresh_key = f"auth:refresh:{refresh_jti}"
            await cache.delete(refresh_key)

        logger.info("user_logout", extra={"access_jti": access_jti})

    async def logout_with_tokens(
        self,
        user_id: UUID,
        authorization: str | None = None,
        refresh_token: str | None = None,
    ) -> None:
        """
        使用原始 token 字符串执行登出

        - 从 Authorization header 提取 access token 的 jti
        - 从 refresh_token 提取 jti
        - 执行登出操作
        """
        # 从 Authorization header 提取 access token 的 jti
        access_jti = None
        if authorization and authorization.startswith("Bearer "):
            token = authorization[7:]
            try:
                payload = decode_token(token)
                access_jti = payload.get("jti")
            except ValueError:
                pass  # Token 已验证过，此处忽略错误

        # 从 refresh_token 提取 jti
        refresh_jti = None
        if refresh_token:
            try:
                payload = decode_token(refresh_token)
                refresh_jti = payload.get("jti")
            except ValueError:
                pass  # 忽略无效的 refresh token

        if access_jti:
            await self.logout(access_jti, refresh_jti)
            logger.info("logout_success", extra={"user_id": str(user_id)})

    async def revoke_all_tokens(self, user_id: UUID) -> None:
        """撤销用户所有 token（递增 token_version）"""
        await self.user_repo.increment_token_version(user_id)
        logger.info("all_tokens_revoked", extra={"user_id": str(user_id)})

    async def is_token_blacklisted(self, jti: str) -> bool:
        """检查 token 是否在黑名单中"""
        blacklist_key = f"auth:access:{jti}"
        data = await cache.get(blacklist_key)
        return data is not None

    # ========== 登录限流 ==========

    async def check_login_rate_limit(self, email: str) -> None:
        """检查登录限流"""
        fail_key = f"auth:login_fail:{email}"
        fail_count = await cache.get(fail_key)
        if fail_count and fail_count >= settings.LOGIN_RATE_LIMIT_ATTEMPTS:
            logger.warning("login_rate_limited", extra={"email": email, "count": fail_count})
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts, please try again later",
            )

    async def increment_login_failure(self, email: str) -> int:
        """记录登录失败"""
        fail_key = f"auth:login_fail:{email}"
        fail_count = await cache.get(fail_key) or 0
        fail_count += 1
        await cache.set(fail_key, fail_count, ttl=settings.LOGIN_RATE_LIMIT_WINDOW)
        return fail_count

    async def reset_login_failures(self, email: str) -> None:
        """重置登录失败计数"""
        fail_key = f"auth:login_fail:{email}"
        await cache.delete(fail_key)

    # ========== 验证码 ==========

    async def send_verification_code(self, email: str, purpose: str) -> str:
        """发送验证码（Mock：输出到控制台）"""
        code = generate_verification_code()
        code_key = f"auth:verify:{email}:{purpose}"
        await cache.set(code_key, code, ttl=600)  # 10 分钟有效

        # Mock 邮件：输出到控制台
        logger.info(
            "verification_code_sent",
            extra={
                "email": email,
                "purpose": purpose,
                "code": code,  # 生产环境应移除
                "message": f"[MOCK EMAIL] Verification code for {purpose}: {code}",
            },
        )
        print(f"\n{'='*50}")
        print(f"[MOCK EMAIL] To: {email}")
        print(f"[MOCK EMAIL] Purpose: {purpose}")
        print(f"[MOCK EMAIL] Verification Code: {code}")
        print(f"{'='*50}\n")

        return code

    async def verify_code(self, email: str, code: str, purpose: str) -> bool:
        """验证验证码"""
        code_key = f"auth:verify:{email}:{purpose}"
        stored_code = await cache.get(code_key)

        if not stored_code or stored_code != code:
            logger.warning("verification_failed", extra={"email": email, "purpose": purpose})
            return False

        # 验证成功后删除验证码（单次使用）
        await cache.delete(code_key)
        logger.info("verification_success", extra={"email": email, "purpose": purpose})
        return True

    # ========== 封禁相关 ==========

    async def ban_user(
        self,
        user_id: UUID,
        reason: str,
        duration_hours: int | None = None,
        tenant_id: UUID | None = None,
    ) -> None:
        """封禁用户"""
        ban_key = f"auth:ban:{user_id}"
        ban_data = {
            "type": "temporary" if duration_hours else "permanent",
            "reason": reason,
            "tenant_id": str(tenant_id) if tenant_id else None,
            "expires_at": (
                (datetime.now(UTC) + timedelta(hours=duration_hours)).isoformat()
                if duration_hours
                else None
            ),
        }

        ttl = duration_hours * 3600 if duration_hours else None  # 永久封禁不过期
        await cache.set(ban_key, ban_data, ttl=ttl)
        # 为网关添加统一封禁标记
        await cache.set(CacheKeys.user_ban(str(user_id)), ban_data, ttl=ttl)
        if tenant_id:
            await cache.set(CacheKeys.tenant_ban(str(tenant_id)), ban_data, ttl=ttl)

        # 撤销所有 token
        await self.revoke_all_tokens(user_id)

        # 吊销相关 API Key（用户级 + 租户级）
        api_key_repo = ApiKeyRepository(self.db)
        api_key_service = ApiKeyService(
            repository=api_key_repo,
            redis_client=getattr(cache, "_redis", None),
            secret_key=settings.JWT_SECRET_KEY or "dev-secret",
        )
        await api_key_service.revoke_user_keys(user_id, reason)
        if tenant_id:
            await api_key_service.revoke_tenant_keys(tenant_id, reason)

        logger.info(
            "user_banned",
            extra={
                "user_id": str(user_id),
                "reason": reason,
                "duration_hours": duration_hours,
                "tenant_id": str(tenant_id) if tenant_id else None,
            },
        )

    async def ban_tenant(
        self,
        tenant_id: UUID,
        reason: str,
        duration_hours: int | None = None,
    ) -> None:
        """
        封禁租户：
        - 写入租户封禁黑名单
        - 吊销租户下所有 API Key
        """
        ban_data = {
            "type": "temporary" if duration_hours else "permanent",
            "reason": reason,
            "tenant_id": str(tenant_id),
            "expires_at": (
                (datetime.now(UTC) + timedelta(hours=duration_hours)).isoformat()
                if duration_hours
                else None
            ),
        }
        ttl = duration_hours * 3600 if duration_hours else None
        await cache.set(CacheKeys.tenant_ban(str(tenant_id)), ban_data, ttl=ttl)

        api_key_repo = ApiKeyRepository(self.db)
        api_key_service = ApiKeyService(
            repository=api_key_repo,
            redis_client=getattr(cache, "_redis", None),
            secret_key=settings.JWT_SECRET_KEY or "dev-secret",
        )
        await api_key_service.revoke_tenant_keys(tenant_id, reason)

        logger.info(
            "tenant_banned",
            extra={
                "tenant_id": str(tenant_id),
                "reason": reason,
                "duration_hours": duration_hours,
            },
        )

    async def unban_user(self, user_id: UUID) -> None:
        """解封用户"""
        ban_key = f"auth:ban:{user_id}"
        ban_data = await cache.get(CacheKeys.user_ban(str(user_id)))
        await cache.delete(ban_key)
        await cache.delete(CacheKeys.user_ban(str(user_id)))
        # 同时尝试清理可能的租户封禁标记（如果此前记录了 tenant_id）
        if ban_data and ban_data.get("tenant_id"):
            await cache.delete(CacheKeys.tenant_ban(ban_data["tenant_id"]))
        logger.info("user_unbanned", extra={"user_id": str(user_id)})

    async def unban_tenant(self, tenant_id: UUID) -> None:
        """解除租户封禁"""
        await cache.delete(CacheKeys.tenant_ban(str(tenant_id)))
        logger.info("tenant_unbanned", extra={"tenant_id": str(tenant_id)})

    async def get_ban_status(self, user_id: UUID) -> dict | None:
        """获取封禁状态"""
        ban_key = f"auth:ban:{user_id}"
        ban_data = await cache.get(ban_key)

        if not ban_data:
            return None

        # 检查临时封禁是否已过期
        if ban_data.get("type") == "temporary" and ban_data.get("expires_at"):
            expires_at = datetime.fromisoformat(ban_data["expires_at"])
            if datetime.now(UTC) > expires_at:
                await cache.delete(ban_key)
                return None

        return ban_data

    # ========== 用户注册相关 ==========

    async def register_user(
        self,
        email: str,
        password: str,
        username: str | None = None,
        invite_code: str | None = None,
    ) -> User:
        """通过统一管线注册新用户（邮箱+密码）。"""
        # 显式注册场景：若邮箱已存在直接报错，避免与 OAuth 自动绑定逻辑混用
        existing = await self.user_repo.get_by_email(email)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )

        user = await self.provisioner.provision_user(
            email=email,
            auth_provider="password",
            external_id=None,
            invite_code=invite_code,
            username=username,
            password=password,
        )

        if not user.is_active:
            await self.send_verification_code(email, "activate")

        return user

    async def activate_user(self, email: str, code: str) -> User:
        """激活用户账号"""
        if not await self.verify_code(email, code, "activate"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired verification code",
            )

        user = await self.user_repo.get_by_email(email)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        if user.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User already activated",
            )

        user = await self.user_repo.activate_user(user.id)
        logger.info("user_activated", extra={"user_id": str(user.id), "email": email})
        return user

    async def request_password_reset(self, email: str) -> None:
        """请求密码重置"""
        user = await self.user_repo.get_by_email(email)
        if not user:
            # 不透露用户是否存在
            logger.info("password_reset_requested_unknown_email", extra={"email": email})
            return

        await self.send_verification_code(email, "reset_password")

    async def confirm_password_reset(self, email: str, code: str, new_password: str) -> None:
        """确认密码重置"""
        if not await self.verify_code(email, code, "reset_password"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired verification code",
            )

        user = await self.user_repo.get_by_email(email)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        hashed_password = get_password_hash(new_password)
        await self.user_repo.update_password(user.id, hashed_password)
        logger.info("password_reset_completed", extra={"user_id": str(user.id), "email": email})

    async def change_password(
        self,
        user: User,
        old_password: str,
        new_password: str,
    ) -> None:
        """修改密码"""
        if not verify_password(old_password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect",
            )

        hashed_password = get_password_hash(new_password)
        await self.user_repo.update_password(user.id, hashed_password)
        logger.info("password_changed", extra={"user_id": str(user.id)})
