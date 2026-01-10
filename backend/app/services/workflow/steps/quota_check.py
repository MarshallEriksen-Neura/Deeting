"""
QuotaCheckStep: 配额检查与原子扣减（P0-1 核心改动）

设计要点：
- 使用 Redis Lua 脚本 quota_deduct.lua 进行原子扣减（余额 + 日/月请求计数）
- 缓存未命中时从 DB 预热 Redis Hash（使用 SETNX 防止竞态）
- Redis 不可用时回退到 DB 扣减（QuotaRepository.check_and_deduct）
- 扣减在此步骤完成，BillingStep 只记录流水
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.repositories.api_key import ApiKeyRepository
from app.repositories.quota_repository import InsufficientQuotaError, QuotaRepository
from app.services.orchestrator.context import ErrorSource
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepConfig, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


class QuotaExceededError(Exception):
    """配额超限异常"""

    def __init__(self, quota_type: str, required: float, available: float):
        self.quota_type = quota_type
        self.required = required
        self.available = available
        super().__init__(f"{quota_type} quota insufficient: required={required}, available={available}")


@step_registry.register
class QuotaCheckStep(BaseStep):
    """
    配额检查步骤（只检查不扣减）

    从上下文读取:
        - ctx.tenant_id
        - ctx.api_key_id
        - routing.pricing_config (用于估算费用)

    写入上下文:
        - quota_check.remaining_balance
        - quota_check.daily_remaining
        - quota_check.monthly_remaining
    """

    name = "quota_check"
    depends_on = ["validation"]

    def __init__(self, config: StepConfig | None = None, quota_repo: QuotaRepository | None = None):
        super().__init__(config)
        # 内部通道默认跳过
        if config is None:
            self.config.skip_on_channels = ["internal"]
        self.quota_repo = quota_repo
        self.apikey_repo: ApiKeyRepository | None = None

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        tenant_id = ctx.tenant_id
        api_key_id = ctx.api_key_id

        if ctx.db_session is None:
            logger.warning("quota_check_skipped_no_db")
            return StepResult(status=StepStatus.SUCCESS)

        if not tenant_id and not api_key_id:
            if ctx.is_external:
                ctx.mark_error(
                    ErrorSource.GATEWAY,
                    "QUOTA_NO_TENANT",
                    "Tenant or API key required for external requests",
                )
                return StepResult(status=StepStatus.FAILED, message="No tenant or API key provided")
            return StepResult(status=StepStatus.SUCCESS)

        try:
            # 0. API Key 预算/配额检查（保持现有逻辑，防止高层回归）
            await self._check_api_key_quota(ctx, api_key_id)

            quota_info = {}
            if tenant_id:
                estimated_cost = await self._estimate_cost(ctx)
                quota_info = await self._check_quota_redis(ctx, str(tenant_id), estimated_cost)

            if quota_info:
                ctx.set("quota_check", "remaining_balance", quota_info.get("balance"))
                ctx.set("quota_check", "daily_remaining", quota_info.get("daily_remaining"))
                ctx.set("quota_check", "monthly_remaining", quota_info.get("monthly_remaining"))

            logger.debug(
                "quota_check_pass trace_id=%s tenant=%s daily=%s monthly=%s",
                ctx.trace_id,
                tenant_id,
                quota_info.get("daily_remaining") if quota_info else None,
                quota_info.get("monthly_remaining") if quota_info else None,
            )
            return StepResult(status=StepStatus.SUCCESS, data=quota_info)

        except QuotaExceededError as e:
            logger.warning("quota_exceeded trace_id=%s type=%s required=%s available=%s", ctx.trace_id, e.quota_type, e.required, e.available)
            ctx.mark_error(
                ErrorSource.GATEWAY,
                f"QUOTA_{e.quota_type.upper()}_EXCEEDED",
                str(e),
            )
            return StepResult(status=StepStatus.FAILED, message=str(e))
        except Exception as exc:  # 降级放行
            logger.warning(f"quota_check_degraded trace_id={ctx.trace_id} err={exc}")
            return StepResult(status=StepStatus.SUCCESS, message="quota check degraded")

    async def _check_api_key_quota(self, ctx: "WorkflowContext", api_key_id) -> None:
        """
        API Key 配额与预算检查（P0-2 增强）
        
        检查顺序：
        1. 预算上限（budget_limit vs budget_used）- 优先从 Redis Hash 读取
        2. 请求配额（request quota）
        3. Token 配额（token quota）
        """
        if not api_key_id:
            return

        # 1. 预算上限检查（优先从 Redis Hash 读取）
        budget_limit = ctx.get("external_auth", "budget_limit")
        if budget_limit is not None:
            budget_used = await self._get_apikey_budget_used(ctx, str(api_key_id))
            if budget_used >= float(budget_limit):
                raise QuotaExceededError("budget", float(budget_limit), float(budget_used))
            # 更新上下文中的 budget_used
            ctx.set("external_auth", "budget_used", budget_used)

        # 2. 继续使用原 API Key quota 检查（Redis -> DB 回退）
        repo = self.apikey_repo or ApiKeyRepository(ctx.db_session)
        from app.models.api_key import QuotaType
        quotas = await repo.get_quotas(api_key_id, quota_type=None)
        for quota in quotas or []:
            if quota.quota_type == QuotaType.REQUEST and quota.used_quota >= quota.total_quota:
                raise QuotaExceededError("apikey_request", quota.total_quota, quota.used_quota)
            if quota.quota_type == QuotaType.TOKEN and quota.total_quota > 0 and quota.used_quota >= quota.total_quota:
                raise QuotaExceededError("apikey_token", quota.total_quota, quota.used_quota)

    async def _get_apikey_budget_used(self, ctx: "WorkflowContext", api_key_id: str) -> float:
        """
        获取 API Key 的 budget_used（P0-2）
        
        优先从 Redis Hash 读取，未命中时从 DB 预热。
        """
        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            # Redis 不可用，从上下文或 DB 读取
            budget_used = ctx.get("external_auth", "budget_used")
            return float(budget_used) if budget_used is not None else 0.0

        try:
            key = CacheKeys.apikey_budget_hash(api_key_id)
            full_key = cache._make_key(key)
            
            # 检查 Redis Hash 是否存在
            exists = await redis_client.exists(full_key)
            if not exists:
                # 预热 API Key 预算到 Redis
                await self._warm_apikey_budget_cache(ctx, redis_client, key, api_key_id)
            
            # 从 Redis 读取 budget_used（存储为微分单位，需要除以 1000000）
            budget_used_micro = await redis_client.hget(full_key, "budget_used")
            if budget_used_micro is None:
                return 0.0
            
            return float(budget_used_micro) / 1000000.0
        except Exception as exc:
            logger.warning("get_apikey_budget_used_failed api_key=%s err=%s", api_key_id, exc)
            # 降级到上下文或 DB
            budget_used = ctx.get("external_auth", "budget_used")
            return float(budget_used) if budget_used is not None else 0.0

    async def _warm_apikey_budget_cache(
        self,
        ctx: "WorkflowContext",
        redis_client,
        cache_key: str,
        api_key_id: str,
    ) -> None:
        """
        预热 API Key 预算到 Redis Hash（P0-2）
        
        使用 SETNX 防止竞态。
        """
        full_key = cache._make_key(cache_key)
        lock_key = f"{full_key}:warming"
        
        # 尝试获取预热锁
        acquired = await redis_client.set(lock_key, "1", ex=5, nx=True)
        if not acquired:
            # 其他请求正在预热，等待后返回
            await asyncio.sleep(0.05)
            return

        try:
            # 从 DB 读取 API Key
            repo = self.apikey_repo or ApiKeyRepository(ctx.db_session)
            from sqlalchemy import select
            from app.models.api_key import ApiKey
            
            stmt = select(ApiKey).where(ApiKey.id == api_key_id)
            result = await ctx.db_session.execute(stmt)
            api_key = result.scalars().first()
            
            if not api_key:
                logger.warning("warm_apikey_budget_api_key_not_found api_key=%s", api_key_id)
                return
            
            # 写入 Redis Hash（budget_used 使用微分单位存储，避免浮点精度问题）
            budget_used_micro = int((api_key.budget_used or 0) * 1000000)
            budget_limit_micro = int((api_key.budget_limit or 0) * 1000000) if api_key.budget_limit else 0
            
            payload = {
                "budget_used": str(budget_used_micro),
                "budget_limit": str(budget_limit_micro),
                "version": "1",
            }
            await redis_client.hset(full_key, mapping=payload)
            await redis_client.expire(full_key, 86400)
            logger.debug("apikey_budget_cache_warmed api_key=%s", api_key_id)
        finally:
            # 释放预热锁
            await redis_client.delete(lock_key)

    async def _estimate_cost(self, ctx: "WorkflowContext") -> float:
        """估算费用用于余额预检查（流式/非流式都可用）"""
        pricing = ctx.get("routing", "pricing_config") or {}
        if not pricing:
            return 0.0

        request = ctx.get("validation", "request")
        max_tokens = getattr(request, "max_tokens", 4096) if request else 4096
        estimated_tokens = max_tokens * 2  # 输入+输出粗估

        avg_price = (
            float(pricing.get("input_per_1k", 0)) +
            float(pricing.get("output_per_1k", 0))
        ) / 2
        return (estimated_tokens / 1000) * avg_price

    async def _check_quota_redis(self, ctx: "WorkflowContext", tenant_id: str, estimated_cost: float) -> dict:
        """
        Redis Lua 原子扣减配额（P0-1 核心改动）
        
        使用 quota_deduct.lua 进行原子扣减：
        - 扣减余额
        - 增加日/月请求计数
        - 返回扣减后的配额信息
        """
        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            return await self._deduct_quota_db(ctx, tenant_id, estimated_cost)

        script_sha = cache.get_script_sha("quota_deduct")
        if not script_sha:
            await cache.preload_scripts()
            script_sha = cache.get_script_sha("quota_deduct")

        if not script_sha:
            logger.warning("quota_deduct_script_not_found, fallback to DB")
            return await self._deduct_quota_db(ctx, tenant_id, estimated_cost)

        key = CacheKeys.quota_hash(tenant_id)
        exists = await redis_client.exists(cache._make_key(key))
        if not exists:
            await self._warm_quota_cache_safe(ctx, redis_client, key, tenant_id)

        today = self._today_str()
        month = self._month_str()

        # 调用 quota_deduct.lua 进行原子扣减
        # args: amount, daily_requests, monthly_requests, today, month, allow_negative
        result = await redis_client.evalsha(
            script_sha,
            keys=[cache._make_key(key)],
            args=[
                str(estimated_cost),  # amount
                "1",  # daily_requests
                "1",  # monthly_requests
                today,
                month,
                "0",  # allow_negative=False（配额检查阶段不允许负余额）
            ],
        )

        if result[0] == 0:
            # 扣减失败
            err = result[1]
            if err == "INSUFFICIENT_BALANCE":
                raise QuotaExceededError("balance", float(result[2]), float(result[3]))
            if err == "DAILY_QUOTA_EXCEEDED":
                raise QuotaExceededError("daily", float(result[2]), float(result[3]))
            if err == "MONTHLY_QUOTA_EXCEEDED":
                raise QuotaExceededError("monthly", float(result[2]), float(result[3]))
            raise QuotaExceededError("unknown", 0, 0)

        # 扣减成功，返回扣减后的配额信息
        # result: [1, "OK", new_balance, daily_used, monthly_used, version]
        return {
            "balance": float(result[2]),
            "daily_used": int(result[3]),
            "monthly_used": int(result[4]),
            "version": int(result[5]),
            "daily_remaining": None,  # 需要从配额总量计算
            "monthly_remaining": None,
        }

    async def _warm_quota_cache_safe(self, ctx: "WorkflowContext", redis_client, cache_key: str, tenant_id: str) -> None:
        """
        从 DB 预热配额 Hash，使用 SETNX 防止竞态（P2-7）
        
        多个并发请求可能同时发现缓存未命中，使用 SETNX 确保只有一个请求执行预热。
        """
        full_key = cache._make_key(cache_key)
        lock_key = f"{full_key}:warming"
        
        # 尝试获取预热锁（5 秒过期）
        acquired = await redis_client.set(lock_key, "1", ex=5, nx=True)
        if not acquired:
            # 其他请求正在预热，等待一小段时间后重试
            await asyncio.sleep(0.05)
            # 检查缓存是否已被预热
            exists = await redis_client.exists(full_key)
            if exists:
                return
            # 仍未预热，继续等待或降级到 DB
            await asyncio.sleep(0.05)
            return

        try:
            # 持有锁，执行预热
            repo = self.quota_repo or QuotaRepository(ctx.db_session)
            quota = await repo.get_or_create(tenant_id)
            payload = {
                "balance": str(quota.balance),
                "credit_limit": str(quota.credit_limit),
                "daily_quota": str(quota.daily_quota),
                "daily_used": str(quota.daily_used),
                "daily_date": quota.daily_reset_at.isoformat() if quota.daily_reset_at else self._today_str(),
                "monthly_quota": str(quota.monthly_quota),
                "monthly_used": str(quota.monthly_used),
                "monthly_month": quota.monthly_reset_at.strftime("%Y-%m") if quota.monthly_reset_at else self._month_str(),
                "rpm_limit": str(quota.rpm_limit) if quota.rpm_limit else "0",
                "tpm_limit": str(quota.tpm_limit) if quota.tpm_limit else "0",
                "version": str(quota.version),
            }
            await redis_client.hset(full_key, mapping=payload)
            await redis_client.expire(full_key, 86400)
            logger.debug("quota_cache_warmed tenant=%s", tenant_id)
        finally:
            # 释放预热锁
            await redis_client.delete(lock_key)

    async def _deduct_quota_db(self, ctx: "WorkflowContext", tenant_id: str, estimated_cost: float) -> dict:
        """
        DB 回退路径：直接扣减配额（P0-1）
        
        Redis 不可用时，使用 QuotaRepository 的 check_and_deduct 方法进行扣减。
        """
        from decimal import Decimal

        repo = self.quota_repo or QuotaRepository(ctx.db_session)
        
        try:
            quota = await repo.check_and_deduct(
                tenant_id=tenant_id,
                balance_amount=Decimal(str(estimated_cost)),
                daily_requests=1,
                monthly_requests=1,
                allow_negative=False,
                commit=False,  # 不提交，由外层事务控制
                sync_cache=False,  # 不同步缓存（Redis 不可用）
                invalidate_cache=False,
            )
            
            daily_remaining = quota.daily_quota - quota.daily_used
            monthly_remaining = quota.monthly_quota - quota.monthly_used
            
            return {
                "balance": float(quota.balance),
                "credit_limit": float(quota.credit_limit),
                "daily_remaining": int(daily_remaining),
                "monthly_remaining": int(monthly_remaining),
                "daily_used": int(quota.daily_used),
                "monthly_used": int(quota.monthly_used),
                "version": int(quota.version),
            }
        except InsufficientQuotaError as e:
            # 转换为 QuotaExceededError
            raise QuotaExceededError(e.quota_type, e.required, e.available) from e

    @staticmethod
    def _today_str() -> str:
        from datetime import date
        return date.today().isoformat()

    @staticmethod
    def _month_str() -> str:
        from datetime import date
        d = date.today()
        return f"{d.year:04d}-{d.month:02d}"
