"""
QuotaRepository: 配额/余额查询与管理

提供基于 TenantQuota 表的配额管理：
- 配额查询（优先缓存，缓存未命中时从 DB 加载）
- 配额扣减（DB 事务 + 缓存同步）
- 配额重置（日/月配额自动重置）
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_invalidation import CacheInvalidator
from app.core.cache_keys import CacheKeys
from app.core.logging import logger
from app.models.billing import TenantQuota
from app.utils.time_utils import Datetime


class InsufficientQuotaError(Exception):
    """配额不足异常"""

    def __init__(self, quota_type: str, required: float, available: float):
        self.quota_type = quota_type
        self.required = required
        self.available = available
        super().__init__(f"{quota_type} quota insufficient: required={required}, available={available}")


class QuotaRepository:
    """配额管理 Repository"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self._invalidator = CacheInvalidator()
        self._cache_ttl = 120

    async def get_or_create(
        self,
        tenant_id: str | uuid.UUID,
        defaults: dict | None = None,
        commit: bool = True,
    ) -> TenantQuota:
        """获取或创建租户配额记录

        commit=False 时仅 flush，便于与外部事务配合。
        """
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)

        stmt = select(TenantQuota).where(TenantQuota.tenant_id == tenant_id)
        result = await self.session.execute(stmt)
        quota = result.scalars().first()

        if quota:
            # 检查是否需要重置配额
            quota = await self._maybe_reset_quotas(quota, commit=commit)
            return quota

        # 创建新记录
        defaults = defaults or {}
        quota = TenantQuota(
            tenant_id=tenant_id,
            balance=Decimal(str(defaults.get("balance", 0))),
            daily_quota=defaults.get("daily_quota", 10000),
            monthly_quota=defaults.get("monthly_quota", 300000),
            rpm_limit=defaults.get("rpm_limit", 60),
            tpm_limit=defaults.get("tpm_limit", 100000),
        )
        self.session.add(quota)
        if commit:
            await self.session.commit()
            await self.session.refresh(quota)
        else:
            await self.session.flush()

        # 更新缓存（仅在已提交时写缓存，避免脏数据）
        if commit:
            await self._update_cache(quota)
            await self._sync_redis_hash(quota)
        return quota

    async def get_quota(
        self,
        tenant_id: str | None,
        api_key_id: str | None = None,
    ) -> dict | None:
        """
        获取配额信息（优先从缓存读取）

        返回格式:
        {
            "balance": float,
            "daily_remaining": int,
            "monthly_remaining": int,
            "rpm_limit": int,
            "tpm_limit": int,
            "token_remaining": int,
        }
        """
        if not tenant_id:
            return None

        cache_key = CacheKeys.quota_tenant(tenant_id)
        version = await self._invalidator.get_version()

        # 尝试从缓存读取
        cached = await cache.get_with_version(cache_key, version)
        if cached:
            return cached

        # 从 DB 加载
        quota = await self.get_or_create(tenant_id)

        result = {
            "balance": float(quota.balance),
            "credit_limit": float(quota.credit_limit),
            "daily_remaining": max(0, quota.daily_quota - quota.daily_used),
            "monthly_remaining": max(0, quota.monthly_quota - quota.monthly_used),
            "rpm_limit": quota.rpm_limit,
            "tpm_limit": quota.tpm_limit,
            "token_remaining": max(0, quota.token_quota - quota.token_used) if quota.token_quota > 0 else -1,
        }

        # 写入缓存
        ttl = cache.jitter_ttl(self._cache_ttl)
        if version is not None:
            await cache.set_with_version(cache_key, result, version, ttl=ttl)
        else:
            await cache.set(cache_key, result, ttl=ttl)

        return result

    async def check_and_deduct(
        self,
        tenant_id: str | uuid.UUID,
        balance_amount: Decimal | float = Decimal("0"),
        daily_requests: int = 0,
        monthly_requests: int = 0,
        tokens: int = 0,
        allow_negative: bool = False,
        commit: bool = True,
        sync_cache: bool = True,
        invalidate_cache: bool = True,
    ) -> TenantQuota:
        """
        检查并扣减配额（原子操作）

        Args:
            tenant_id: 租户 ID
            balance_amount: 扣减余额
            daily_requests: 扣减日请求数
            monthly_requests: 扣减月请求数
            tokens: 扣减 Token 数
            allow_negative: 是否允许余额为负（信用额度内）

        Returns:
            更新后的配额记录

        Raises:
            InsufficientQuotaError: 配额不足
        """
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)

        quota = await self.get_or_create(tenant_id, commit=False)

        # 检查余额
        if balance_amount > 0:
            effective_balance = quota.balance + quota.credit_limit
            if not allow_negative and effective_balance < Decimal(str(balance_amount)):
                raise InsufficientQuotaError("balance", float(balance_amount), float(effective_balance))

        # 检查日配额
        if daily_requests > 0:
            daily_remaining = quota.daily_quota - quota.daily_used
            if daily_remaining < daily_requests:
                raise InsufficientQuotaError("daily_requests", daily_requests, daily_remaining)

        # 检查月配额
        if monthly_requests > 0:
            monthly_remaining = quota.monthly_quota - quota.monthly_used
            if monthly_remaining < monthly_requests:
                raise InsufficientQuotaError("monthly_requests", monthly_requests, monthly_remaining)

        # 检查 Token 配额
        if tokens > 0 and quota.token_quota > 0:
            token_remaining = quota.token_quota - quota.token_used
            if token_remaining < tokens:
                raise InsufficientQuotaError("tokens", tokens, token_remaining)

        # 执行扣减（使用乐观锁）
        old_version = quota.version
        stmt = (
            update(TenantQuota)
            .where(
                TenantQuota.id == quota.id,
                TenantQuota.version == old_version,
            )
            .values(
                balance=TenantQuota.balance - Decimal(str(balance_amount)),
                daily_used=TenantQuota.daily_used + daily_requests,
                monthly_used=TenantQuota.monthly_used + monthly_requests,
                token_used=TenantQuota.token_used + tokens,
                version=TenantQuota.version + 1,
                updated_at=Datetime.now(),
            )
            .returning(TenantQuota)
        )

        result = await self.session.execute(stmt)
        updated = result.scalars().first()

        if not updated:
            # 乐观锁冲突，重试
            await self.session.rollback()
            logger.warning(f"quota_optimistic_lock_conflict tenant={tenant_id}")
            return await self.check_and_deduct(
                tenant_id,
                balance_amount,
                daily_requests,
                monthly_requests,
                tokens,
                allow_negative,
                commit,
                sync_cache,
                invalidate_cache,
            )

        if commit:
            await self.session.commit()
        else:
            await self.session.flush()

        if commit and invalidate_cache:
            await self._invalidate_cache(str(tenant_id))
        if commit and sync_cache:
            await self._sync_redis_hash(updated)

        return updated

    async def deduct_balance(self, tenant_id: str, amount: float) -> float:
        """扣减余额（兼容旧接口）"""
        quota = await self.check_and_deduct(tenant_id, balance_amount=Decimal(str(amount)), allow_negative=True)
        return float(quota.balance)

    async def add_balance(
        self,
        tenant_id: str | uuid.UUID,
        amount: Decimal | float,
    ) -> TenantQuota:
        """充值余额"""
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)

        quota = await self.get_or_create(tenant_id)

        stmt = (
            update(TenantQuota)
            .where(TenantQuota.id == quota.id)
            .values(
                balance=TenantQuota.balance + Decimal(str(amount)),
                version=TenantQuota.version + 1,
                updated_at=Datetime.now(),
            )
            .returning(TenantQuota)
        )

        result = await self.session.execute(stmt)
        updated = result.scalars().first()
        await self.session.commit()

        await self._invalidate_cache(str(tenant_id))
        await self._sync_redis_hash(updated)
        return updated

    async def update_limits(
        self,
        tenant_id: str | uuid.UUID,
        rpm_limit: int | None = None,
        tpm_limit: int | None = None,
        daily_quota: int | None = None,
        monthly_quota: int | None = None,
        token_quota: int | None = None,
        credit_limit: Decimal | None = None,
    ) -> TenantQuota:
        """更新配额限制"""
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)

        quota = await self.get_or_create(tenant_id)

        values = {"updated_at": Datetime.now()}
        if rpm_limit is not None:
            values["rpm_limit"] = rpm_limit
        if tpm_limit is not None:
            values["tpm_limit"] = tpm_limit
        if daily_quota is not None:
            values["daily_quota"] = daily_quota
        if monthly_quota is not None:
            values["monthly_quota"] = monthly_quota
        if token_quota is not None:
            values["token_quota"] = token_quota
        if credit_limit is not None:
            values["credit_limit"] = credit_limit

        stmt = (
            update(TenantQuota)
            .where(TenantQuota.id == quota.id)
            .values(**values)
            .returning(TenantQuota)
        )

        result = await self.session.execute(stmt)
        updated = result.scalars().first()
        await self.session.commit()

        await self._invalidate_cache(str(tenant_id))
        await self._sync_redis_hash(updated)
        return updated

    async def _maybe_reset_quotas(self, quota: TenantQuota, commit: bool = True) -> TenantQuota:
        """检查并重置过期的配额"""
        today = date.today()
        needs_update = False
        values = {}

        # 日配额重置
        if quota.daily_reset_at is None or quota.daily_reset_at < today:
            values["daily_used"] = 0
            values["daily_reset_at"] = today
            needs_update = True

        # 月配额重置（每月 1 号）
        first_of_month = today.replace(day=1)
        if quota.monthly_reset_at is None or quota.monthly_reset_at < first_of_month:
            values["monthly_used"] = 0
            values["monthly_reset_at"] = first_of_month
            needs_update = True

        if needs_update:
            values["updated_at"] = Datetime.now()
            stmt = (
                update(TenantQuota)
                .where(TenantQuota.id == quota.id)
                .values(**values)
            )
            await self.session.execute(stmt)
            if commit:
                await self.session.commit()
            else:
                await self.session.flush()
            # 重新加载最新值
            result = await self.session.execute(select(TenantQuota).where(TenantQuota.id == quota.id))
            quota = result.scalars().first()

            if commit:
                await self._invalidate_cache(str(quota.tenant_id))
                await self._sync_redis_hash(quota)

        return quota

    async def _update_cache(self, quota: TenantQuota) -> None:
        """更新缓存"""
        cache_key = CacheKeys.quota_tenant(str(quota.tenant_id))
        version = await self._invalidator.bump_version()

        result = {
            "balance": float(quota.balance),
            "credit_limit": float(quota.credit_limit),
            "daily_remaining": max(0, quota.daily_quota - quota.daily_used),
            "monthly_remaining": max(0, quota.monthly_quota - quota.monthly_used),
            "rpm_limit": quota.rpm_limit,
            "tpm_limit": quota.tpm_limit,
            "token_remaining": max(0, quota.token_quota - quota.token_used) if quota.token_quota > 0 else -1,
        }

        ttl = cache.jitter_ttl(self._cache_ttl)
        if version is not None:
            await cache.set_with_version(cache_key, result, version, ttl=ttl)
        else:
            await cache.set(cache_key, result, ttl=ttl)

    async def _sync_redis_hash(self, quota: TenantQuota) -> None:
        """同步 Redis Hash（供 Lua 脚本使用）"""
        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            return

        key = cache._make_key(CacheKeys.quota_hash(str(quota.tenant_id)))
        balance_str = str(Decimal(str(quota.balance)).normalize())
        payload = {
            "balance": balance_str,
            "credit_limit": str(quota.credit_limit),
            "daily_quota": int(quota.daily_quota),
            "daily_used": int(quota.daily_used),
            "daily_date": quota.daily_reset_at.isoformat() if quota.daily_reset_at else date.today().isoformat(),
            "monthly_quota": int(quota.monthly_quota),
            "monthly_used": int(quota.monthly_used),
            "monthly_month": quota.monthly_reset_at.strftime("%Y-%m") if quota.monthly_reset_at else date.today().strftime("%Y-%m"),
            "rpm_limit": int(quota.rpm_limit),
            "tpm_limit": int(quota.tpm_limit),
            "version": int(quota.version),
        }
        try:
            await redis_client.hset(key, mapping=payload)
            await redis_client.expire(key, 86400)
        except Exception as exc:
            logger.warning(f"quota_sync_redis_hash_failed tenant={quota.tenant_id} exc={exc}")

    async def _invalidate_cache(self, tenant_id: str) -> None:
        """失效缓存"""
        cache_key = CacheKeys.quota_tenant(tenant_id)
        await cache.delete(cache_key)
        await self._invalidator.bump_version()
