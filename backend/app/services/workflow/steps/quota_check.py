"""
QuotaCheckStep: 配额检查与原子扣减（P0-1 核心改动）

设计要点：
- 使用 Redis Lua 脚本 quota_deduct.lua 进行原子扣减（余额 + 日/月请求计数）
- 缓存未命中时从 DB 预热 Redis Hash（使用 SETNX 防止竞态）
- Redis 不可用时回退到 DB 扣减（QuotaRepository.check_and_deduct）
- 扣减在此步骤完成，BillingStep 只记录流水
- 核心预扣逻辑已提取到 billing_pipeline，此处为 thin wrapper
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.repositories.api_key import ApiKeyRepository
from app.repositories.quota_repository import QuotaRepository
from app.services.billing_pipeline import (
    QuotaExceededError,
    estimate_cost,
    quota_precheck,
)

# Re-export for backward compatibility
__all__ = ["QuotaCheckStep", "QuotaExceededError"]
from app.services.orchestrator.context import ErrorSource
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import (
    BaseStep,
    StepConfig,
    StepResult,
    StepStatus,
)

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


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

    def __init__(
        self,
        config: StepConfig | None = None,
        quota_repo: QuotaRepository | None = None,
    ):
        super().__init__(config)
        self.quota_repo = quota_repo
        self.apikey_repo: ApiKeyRepository | None = None

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        tenant_id = ctx.tenant_id
        api_key_id = ctx.api_key_id

        if ctx.db_session is None:
            logger.warning("quota_check_skipped_no_db")
            return StepResult(status=StepStatus.SUCCESS)

        if not tenant_id and not api_key_id:
            if ctx.is_external:
                return StepResult(
                    status=StepStatus.SUCCESS, message="skip_external_no_identity"
                )
            return StepResult(status=StepStatus.SUCCESS)

        try:
            await self._check_api_key_quota(ctx, api_key_id)

            quota_info = {}
            if tenant_id:
                pricing = ctx.get("routing", "pricing_config") or {}
                request = ctx.get("validation", "request")
                max_tokens = getattr(request, "max_tokens", 4096) if request else 4096
                estimated_cost = estimate_cost(pricing, max_tokens)
                quota_info = await quota_precheck(
                    str(tenant_id), estimated_cost, ctx.db_session, self.quota_repo,
                )

            if quota_info:
                ctx.set("quota_check", "remaining_balance", quota_info.get("balance"))
                ctx.set(
                    "quota_check", "daily_remaining", quota_info.get("daily_remaining")
                )
                ctx.set(
                    "quota_check",
                    "monthly_remaining",
                    quota_info.get("monthly_remaining"),
                )

            logger.debug(
                "quota_check_pass trace_id=%s tenant=%s daily=%s monthly=%s",
                ctx.trace_id,
                tenant_id,
                quota_info.get("daily_remaining") if quota_info else None,
                quota_info.get("monthly_remaining") if quota_info else None,
            )
            return StepResult(status=StepStatus.SUCCESS, data=quota_info)

        except QuotaExceededError as e:
            logger.warning(
                "quota_exceeded trace_id=%s type=%s required=%s available=%s",
                ctx.trace_id,
                e.quota_type,
                e.required,
                e.available,
            )
            ctx.mark_error(
                ErrorSource.GATEWAY,
                f"QUOTA_{e.quota_type.upper()}_EXCEEDED",
                str(e),
            )
            return StepResult(status=StepStatus.FAILED, message=str(e))
        except Exception as exc:  # 降级放行
            logger.warning(f"quota_check_degraded trace_id={ctx.trace_id} err={exc}")
            return StepResult(status=StepStatus.SUCCESS, message="quota check degraded")

    async def _check_api_key_quota(self, ctx: WorkflowContext, api_key_id) -> None:
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
                raise QuotaExceededError(
                    "budget", float(budget_limit), float(budget_used)
                )
            # 更新上下文中的 budget_used
            ctx.set("external_auth", "budget_used", budget_used)

        # 2. 继续使用原 API Key quota 检查（Redis -> DB 回退）
        repo = self.apikey_repo or ApiKeyRepository(ctx.db_session)
        from app.models.api_key import QuotaType

        api_key = await repo.get_by_id(api_key_id)
        if not api_key:
            return
        for quota in api_key.quotas or []:
            if (
                quota.quota_type == QuotaType.REQUEST
                and quota.used_quota >= quota.total_quota
            ):
                raise QuotaExceededError(
                    "apikey_request", quota.total_quota, quota.used_quota
                )
            if (
                quota.quota_type == QuotaType.TOKEN
                and quota.total_quota > 0
                and quota.used_quota >= quota.total_quota
            ):
                raise QuotaExceededError(
                    "apikey_token", quota.total_quota, quota.used_quota
                )

    async def _get_apikey_budget_used(
        self, ctx: WorkflowContext, api_key_id: str
    ) -> float:
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
            logger.warning(
                "get_apikey_budget_used_failed api_key=%s err=%s", api_key_id, exc
            )
            # 降级到上下文或 DB
            budget_used = ctx.get("external_auth", "budget_used")
            return float(budget_used) if budget_used is not None else 0.0

    async def _warm_apikey_budget_cache(
        self,
        ctx: WorkflowContext,
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
                logger.warning(
                    "warm_apikey_budget_api_key_not_found api_key=%s", api_key_id
                )
                return

            # 写入 Redis Hash（budget_used 使用微分单位存储，避免浮点精度问题）
            budget_used_micro = int((api_key.budget_used or 0) * 1000000)
            budget_limit_micro = (
                int((api_key.budget_limit or 0) * 1000000)
                if api_key.budget_limit
                else 0
            )

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

    # quota_precheck / estimate_cost / _warm / _deduct_db
    # delegated to app.services.billing_pipeline
