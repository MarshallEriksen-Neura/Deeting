"""
QuotaCheckStep: 配额/额度检查步骤

职责：
- 检查租户/API Key 的配额余额
- 外部通道必选，内部通道可选
- 配额不足时拒绝请求
"""

import logging
from typing import TYPE_CHECKING

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.repositories.api_key import ApiKeyRepository
from app.repositories.quota_repository import QuotaRepository
from app.services.orchestrator.context import ErrorSource
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepConfig, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


class QuotaExceededError(Exception):
    """配额超限异常"""

    def __init__(self, quota_type: str, limit: float, current: float):
        self.quota_type = quota_type
        self.limit = limit
        self.current = current
        super().__init__(
            f"Quota exceeded: {quota_type} limit={limit}, current={current}"
        )


@step_registry.register
class QuotaCheckStep(BaseStep):
    """
    配额检查步骤

    从上下文读取:
        - ctx.tenant_id: 租户 ID
        - ctx.api_key_id: API Key ID

    写入上下文:
        - quota_check.remaining_balance: 剩余余额
        - quota_check.daily_remaining: 日配额剩余
        - quota_check.rpm_remaining: RPM 剩余
        - quota_check.tpm_remaining: TPM 剩余
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
        """执行配额检查"""
        tenant_id = ctx.tenant_id
        api_key_id = ctx.api_key_id

        # 测试/降级场景：没有数据库会话时直接放行，避免阻塞请求
        if ctx.db_session is None:
            logger.warning("quota_check_skipped_no_db")
            return StepResult(status=StepStatus.SUCCESS)

        if not tenant_id and not api_key_id:
            # 无租户信息，外部通道应该拒绝
            if ctx.is_external:
                ctx.mark_error(
                    ErrorSource.GATEWAY,
                    "QUOTA_NO_TENANT",
                    "Tenant or API key required for external requests",
                )
                return StepResult(
                    status=StepStatus.FAILED,
                    message="No tenant or API key provided",
                )
            # 内部通道允许通过
            return StepResult(status=StepStatus.SUCCESS)

        try:
            # 0. 检查 API Key 预算上限 (Fail Fast)
            budget_limit = ctx.get("external_auth", "budget_limit")
            budget_used = ctx.get("external_auth", "budget_used") or 0.0
            
            if budget_limit is not None and budget_used >= budget_limit:
                 raise QuotaExceededError("budget", float(budget_limit), float(budget_used))

            # 1. 检查 API Key 配额 (如果存在)
            if api_key_id:
                await self._check_apikey_quota(ctx, str(api_key_id))

            # 2. 检查租户配额 (如果存在)
            quota_info = {}
            if tenant_id:
                quota_info = await self._check_tenant_quota(ctx, str(tenant_id))

            # 写入上下文 (优先使用租户配额信息，或者混合)
            if quota_info:
                ctx.set("quota_check", "remaining_balance", quota_info.get("balance", 0))
                ctx.set("quota_check", "daily_remaining", quota_info.get("daily_remaining"))
                ctx.set("quota_check", "rpm_remaining", quota_info.get("rpm_remaining"))
                ctx.set("quota_check", "tpm_remaining", quota_info.get("tpm_remaining"))

            logger.debug(
                f"Quota check passed trace_id={ctx.trace_id} "
                f"tenant={tenant_id} apikey={api_key_id}"
            )

            return StepResult(
                status=StepStatus.SUCCESS,
                data=quota_info,
            )

        except QuotaExceededError as e:
            logger.warning(f"Quota exceeded: {e}")
            ctx.mark_error(
                ErrorSource.GATEWAY,
                f"QUOTA_{e.quota_type.upper()}_EXCEEDED",
                str(e),
            )
            return StepResult(
                status=StepStatus.FAILED,
                message=str(e),
            )
        except Exception as exc:
            # 保守降级：配额服务不可用时放行但记录日志
            logger.warning(f"quota_check_degraded trace_id={ctx.trace_id} err={exc}")
            return StepResult(status=StepStatus.SUCCESS, message="quota check degraded")

    async def _check_apikey_quota(self, ctx: "WorkflowContext", api_key_id: str) -> None:
        """检查 API Key 配额"""
        if ctx.db_session is None:
            return

        redis_client = getattr(cache, "_redis", None)
        script_sha = cache.get_script_sha("apikey_quota_check") if redis_client else None

        # 尝试预加载脚本
        if redis_client and not script_sha:
            try:
                await cache.preload_scripts()
                script_sha = cache.get_script_sha("apikey_quota_check")
            except Exception as exc:
                logger.warning(f"preload apikey quota script failed: {exc}")

        if redis_client and script_sha:
            key = f"gw:quota:apikey:{api_key_id}"
            try:
                # 检查缓存是否存在，不存在则预热
                exists = await redis_client.exists(cache._make_key(key))
                if not exists:
                    await self._warm_apikey_quota(ctx, redis_client, key, api_key_id)

                # 执行 Lua 脚本
                today = self._today_str()
                month = self._month_str()
                # ARGV: request_increment, today, month
                res = await redis_client.evalsha(
                    script_sha,
                    keys=[cache._make_key(key)],
                    args=[1, today, month]
                )

                # res: [status, msg, type, limit, used]
                if res and res[0] == 0:
                    raise QuotaExceededError(res[2], float(res[3]), float(res[4]))

                return
            except QuotaExceededError:
                raise
            except Exception as exc:
                logger.warning(f"ApiKey Quota Redis check failed: {exc}")
                pass

        # Fallback to DB check (Simple version)
        repo = self.apikey_repo or ApiKeyRepository(ctx.db_session)
        # Note: We need to cast api_key_id to UUID if needed, but repo usually handles it or expects UUID
        # ApiKeyRepository methods type hint UUID, but SQLAlchemy usually handles str->UUID conversion if using UUID type.
        # However, to be safe, we might need conversion.
        # But ctx.api_key_id is usually UUID (or str of UUID).
        # Let's import UUID to be safe.
        from uuid import UUID
        try:
            uuid_id = UUID(str(api_key_id))
            key_obj = await repo.get_by_id(uuid_id)
            if not key_obj:
                return

            for quota in key_obj.quotas:
                # 简易检查
                if quota.is_exhausted:
                     raise QuotaExceededError(quota.quota_type, quota.total_quota, quota.used_quota)
        except Exception as e:
            logger.error(f"DB fallback quota check failed: {e}")

    async def _warm_apikey_quota(self, ctx, redis_client, cache_key: str, api_key_id: str) -> None:
        """将 API Key 配额预热到 Redis"""
        from uuid import UUID
        repo = self.apikey_repo or ApiKeyRepository(ctx.db_session)
        try:
            uuid_id = UUID(str(api_key_id))
            key_obj = await repo.get_by_id(uuid_id)
            if not key_obj or not key_obj.quotas:
                # 设置一个空标记防止缓存穿透
                await redis_client.setex(cache._make_key(cache_key), 60, "empty")
                return

            payload = {}
            for q in key_obj.quotas:
                # key format: {type}:limit, {type}:used, {type}:period, {type}:date
                # Ensure we use the string value if it's an enum
                qtype = q.quota_type.value if hasattr(q.quota_type, "value") else str(q.quota_type)
                payload[f"{qtype}:limit"] = q.total_quota
                payload[f"{qtype}:used"] = q.used_quota
                payload[f"{qtype}:period"] = q.reset_period.value if hasattr(q.reset_period, "value") else str(q.reset_period)

                # 确定 date 字段
                if payload[f"{qtype}:period"] == "daily":
                    payload[f"{qtype}:date"] = q.reset_at.date().isoformat() if q.reset_at else self._today_str()
                elif payload[f"{qtype}:period"] == "monthly":
                    payload[f"{qtype}:date"] = q.reset_at.strftime("%Y-%m") if q.reset_at else self._month_str()
                else:
                    payload[f"{qtype}:date"] = ""

            if payload:
                await redis_client.hset(cache._make_key(cache_key), mapping=payload)
                await redis_client.expire(cache._make_key(cache_key), 86400) # 1 day ttl
        except Exception as e:
            logger.error(f"Warm apikey quota failed: {e}")

    async def _check_tenant_quota(
        self,
        ctx: "WorkflowContext",
        tenant_id: str,
    ) -> dict:
        """
        检查租户配额

        逻辑：
        1. 先尝试使用 Redis Lua (quota_check_deduct) 原子扣减日/月配额
        2. 缓存未命中或 Redis 不可用时回退到 DB 乐观锁扣减
        3. 重置策略：日配额按日期，月配额按月份字符串自动重置
        """
        if ctx.db_session is None:
            raise QuotaExceededError("balance", 0, 0)

        repo = self.quota_repo or QuotaRepository(ctx.db_session)

        # Lua 原子扣减（优先）
        redis_client = getattr(cache, "_redis", None)
        script_sha = cache.get_script_sha("quota_check_deduct") if redis_client else None
        if redis_client and not script_sha:
            try:
                await cache.preload_scripts()
                script_sha = cache.get_script_sha("quota_check_deduct")
            except Exception as exc:
                logger.warning(f"preload quota script failed: {exc}")
        today = self._today_str()
        month = self._month_str()

        if redis_client and script_sha:
            key = CacheKeys.quota_hash(tenant_id)
            try:
                # 初始化缓存 Hash（惰性填充）
                exists = await redis_client.exists(cache._make_key(key))
                if not exists:
                    await self._warm_quota_cache(redis_client, key, repo, tenant_id)

                # 日配额扣减 1
                daily_res = await redis_client.evalsha(
                    script_sha, keys=[cache._make_key(key)], args=[1, "daily", today]
                )
                if daily_res and daily_res[0] == 0:
                    raise QuotaExceededError("daily", daily_res[1], daily_res[1])

                # 月配额扣减 1
                monthly_res = await redis_client.evalsha(
                    script_sha, keys=[cache._make_key(key)], args=[1, "monthly", month]
                )
                if monthly_res and monthly_res[0] == 0:
                    raise QuotaExceededError("monthly", monthly_res[1], monthly_res[1])

                # 余额仅检查，不扣减（计费步骤扣费）
                balance_val = await self._get_cached_balance(redis_client, key)

                return {
                    "balance": balance_val,
                    "daily_remaining": daily_res[1] if daily_res else None,
                    "monthly_remaining": monthly_res[1] if monthly_res else None,
                    "rpm_remaining": None,
                    "tpm_remaining": None,
                }
            except QuotaExceededError:
                raise
            except Exception as exc:
                logger.warning(f"Quota Redis path failed, fallback to DB: {exc}")

        # DB 回退：乐观锁扣减
        quota = await repo.check_and_deduct(
            tenant_id=tenant_id,
            daily_requests=1,
            monthly_requests=1,
            allow_negative=True,
        )

        return {
            "balance": float(quota.balance),
            "daily_remaining": max(0, quota.daily_quota - quota.daily_used),
            "monthly_remaining": max(0, quota.monthly_quota - quota.monthly_used),
            "rpm_remaining": quota.rpm_limit,
            "tpm_remaining": quota.tpm_limit,
        }

    async def _warm_quota_cache(self, redis_client, cache_key: str, repo: QuotaRepository, tenant_id: str) -> None:
        """将 DB 中的配额快照写入 Redis Hash，供 Lua 使用"""
        quota = await repo.get_or_create(tenant_id)
        payload = {
            "balance": float(quota.balance),
            "daily_limit": int(quota.daily_quota),
            "daily_used": int(quota.daily_used),
            "daily_date": quota.daily_reset_at.isoformat() if quota.daily_reset_at else self._today_str(),
            "monthly_limit": int(quota.monthly_quota),
            "monthly_used": int(quota.monthly_used),
            "monthly_month": quota.monthly_reset_at.strftime("%Y-%m") if quota.monthly_reset_at else self._month_str(),
        }
        await redis_client.hset(cache._make_key(cache_key), mapping=payload)
        # 设置较长 TTL，避免频繁重建；重置时脚本会更新日期字段
        await redis_client.expire(cache._make_key(cache_key), 86400)

    async def _get_cached_balance(self, redis_client, cache_key: str) -> float:
        """获取缓存中的余额，缺失时返回 0"""
        try:
            bal = await redis_client.hget(cache._make_key(cache_key), "balance")
            return float(bal) if bal is not None else 0.0
        except Exception:
            return 0.0

    @staticmethod
    def _today_str() -> str:
        from datetime import date
        return date.today().isoformat()

    @staticmethod
    def _month_str() -> str:
        from datetime import date
        d = date.today()
        return f"{d.year:04d}-{d.month:02d}"
