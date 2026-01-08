"""
RateLimitStep: 限流步骤

职责：
- 按租户/API Key 进行 RPM/TPM 限流
- 外部通道严格限制，内部通道宽松
- 支持滑动窗口和令牌桶算法
"""

import logging
import time
from typing import TYPE_CHECKING

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.services.orchestrator.context import ErrorSource
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


class RateLimitExceededError(Exception):
    """限流超限异常"""

    def __init__(self, limit_type: str, limit: int, retry_after: int = 60):
        self.limit_type = limit_type
        self.limit = limit
        self.retry_after = retry_after
        super().__init__(
            f"Rate limit exceeded: {limit_type}={limit}, retry_after={retry_after}s"
        )


@step_registry.register
class RateLimitStep(BaseStep):
    """
    限流步骤

    从上下文读取:
        - ctx.tenant_id: 租户 ID
        - ctx.api_key_id: API Key ID
        - ctx.client_ip: 客户端 IP

    写入上下文:
        - rate_limit.rpm_remaining: RPM 剩余
        - rate_limit.tpm_remaining: TPM 剩余
        - rate_limit.retry_after: 限流时重试等待秒数
    """

    name = "rate_limit"
    depends_on = ["validation"]

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行限流检查"""
        # 确定限流 key
        rate_key = self._get_rate_key(ctx)

        try:
            rate_info = await self._check_rate_limit(
                ctx=ctx,
                rate_key=rate_key,
                limit_config=ctx.get("routing", "limit_config") or {},
            )

            # 写入上下文
            ctx.set("rate_limit", "rpm_remaining", rate_info.get("rpm_remaining"))
            ctx.set("rate_limit", "tpm_remaining", rate_info.get("tpm_remaining"))

            logger.debug(
                f"Rate limit check passed trace_id={ctx.trace_id} "
                f"key={rate_key} rpm_remaining={rate_info.get('rpm_remaining')}"
            )

            return StepResult(
                status=StepStatus.SUCCESS,
                data=rate_info,
            )

        except RateLimitExceededError as e:
            logger.warning(f"Rate limit exceeded: {e}")
            ctx.mark_error(
                ErrorSource.GATEWAY,
                f"RATE_LIMIT_{e.limit_type.upper()}",
                str(e),
            )
            ctx.set("rate_limit", "retry_after", e.retry_after)
            return StepResult(
                status=StepStatus.FAILED,
                message=str(e),
                data={"retry_after": e.retry_after},
            )

    def _get_rate_key(self, ctx: "WorkflowContext") -> str:
        """
        构建限流 key

        优先级: api_key_id > tenant_id > client_ip
        """
        if ctx.api_key_id:
            return f"ak:{ctx.api_key_id}"
        if ctx.tenant_id:
            return f"tenant:{ctx.tenant_id}"
        if ctx.client_ip:
            return f"ip:{ctx.client_ip}"
        return "global"

    def _resolve_limits(
        self, ctx: "WorkflowContext", limit_config: dict
    ) -> tuple[int, int, int]:
        """合并 provider preset / API Key / settings 默认值"""

        default_rpm = (
            settings.RATE_LIMIT_EXTERNAL_RPM
            if ctx.is_external
            else settings.RATE_LIMIT_INTERNAL_RPM
        )
        default_tpm = (
            settings.RATE_LIMIT_EXTERNAL_TPM
            if ctx.is_external
            else settings.RATE_LIMIT_INTERNAL_TPM
        )
        window_seconds = int(
            limit_config.get("window") or settings.RATE_LIMIT_WINDOW_SECONDS
        )

        rpm_limit = int(
            limit_config.get("rpm")
            or ctx.get("signature_verify", "rate_limit_rpm")
            or default_rpm
        )
        tpm_limit = int(
            limit_config.get("tpm")
            or ctx.get("signature_verify", "rate_limit_tpm")
            or default_tpm
        )

        return rpm_limit, tpm_limit, window_seconds

    def _estimate_tpm_cost(self, ctx: "WorkflowContext") -> int:
        """估算本次请求的 token 消耗，用于 TPM 限流"""
        # 优先使用显式注入的成本
        explicit = ctx.get("rate_limit", "tpm_cost")
        if explicit is not None:
            return max(int(explicit), 1)

        # 其次尝试从校验后的请求中获取 max_tokens
        validated = ctx.get("validation", "validated") or {}
        if isinstance(validated, dict):
            max_tokens = validated.get("max_tokens") or validated.get("max_tokens_per_request")
            if max_tokens:
                return max(int(max_tokens), 1)

        # 如果计费阶段已写入 token 用量（重入/重试场景）
        if hasattr(ctx, "billing") and getattr(ctx.billing, "total_tokens", 0) > 0:
            return max(int(ctx.billing.total_tokens), 1)

        # 保守默认：至少消耗 1 个 token
        return 1

    async def _check_rate_limit(
        self,
        ctx: "WorkflowContext",
        rate_key: str,
        limit_config: dict,
    ) -> dict:
        """
        检查限流

        实际实现应该：
        1. 使用 Redis 实现滑动窗口或令牌桶
        2. 根据通道和 key 获取不同的限流配置
        3. 原子性地检查并递增计数器
        """
        # 优先使用 routing.limit_config + API Key 配置，再回退 settings 默认值
        rpm_limit, tpm_limit, window_seconds = self._resolve_limits(ctx, limit_config)

        # 白名单直接放行
        if ctx.get("signature_verify", "is_whitelist"):
            return {
                "rpm_limit": rpm_limit,
                "rpm_remaining": rpm_limit,
                "tpm_limit": tpm_limit,
                "tpm_remaining": tpm_limit,
                "reset_at": window_seconds,
            }

        redis_client = getattr(cache, "_redis", None)
        now_ms = int(time.time() * 1000)
        now_sec = now_ms / 1000.0

        rpm_script_sha = cache.get_script_sha("sliding_window_rate_limit")
        tpm_script_sha = cache.get_script_sha("token_bucket_rate_limit")

        # 若脚本尚未加载，尝试懒加载一次
        if redis_client and (not rpm_script_sha or not tpm_script_sha):
            try:
                await cache.preload_scripts()
            except Exception as exc:  # 降级到本地实现
                logger.warning(f"preload rate limit script failed: {exc}")
            else:
                rpm_script_sha = cache.get_script_sha("sliding_window_rate_limit")
                tpm_script_sha = cache.get_script_sha("token_bucket_rate_limit")

        # 1. RPM 检查 (滑动窗口)
        rpm_remaining = rpm_limit - 1
        rpm_reset = window_seconds

        if redis_client and rpm_script_sha:
            key = CacheKeys.rate_limit_rpm(rate_key, "chat")
            try:
                res = await redis_client.evalsha(
                    rpm_script_sha,
                    keys=[key],
                    args=[window_seconds, rpm_limit, now_ms, now_ms],
                )
            except Exception:
                # 脚本执行失败，降级到 Python
                pass
            else:
                # res: [allowed, remaining, reset_time]
                if res and res[0] == 0:  # Denied
                    retry_after = res[2] if len(res) > 2 else window_seconds
                    raise RateLimitExceededError("rpm", rpm_limit, retry_after)

                rpm_remaining = res[1] if res and len(res) > 1 else rpm_limit - 1
                rpm_reset = res[2] if res and len(res) > 2 else window_seconds

        # 降级: Python RPM
        elif redis_client:
            key = CacheKeys.rate_limit_rpm(rate_key, "chat")
            try:
                await redis_client.zremrangebyscore(
                    key, 0, now_ms - window_seconds * 1000
                )
                current = await redis_client.zcard(key)
                if current >= rpm_limit:
                    raise RateLimitExceededError("rpm", rpm_limit, window_seconds)
                await redis_client.zadd(key, {str(now_ms): now_ms})
                await redis_client.pexpire(key, window_seconds * 1000)
                rpm_remaining = rpm_limit - current - 1
            except RateLimitExceededError:
                raise
            except Exception as e:
                logger.warning(f"Rate limit fallback failed: {e}")
                rpm_remaining = rpm_limit - 1

        # 2. TPM 检查 (令牌桶)
        tpm_remaining = tpm_limit
        tpm_reset = 0

        # TPM 速率 (Tokens/sec)，窗口等价于 rpm window
        tpm_rate = tpm_limit / float(window_seconds) if window_seconds > 0 else tpm_limit
        # 估算当前消耗
        cost = self._estimate_tpm_cost(ctx)

        if redis_client and tpm_script_sha:
            key = CacheKeys.rate_limit_tpm(rate_key, "chat")
            try:
                # KEYS[1]: key
                # ARGV[1]: capacity (tpm_limit)
                # ARGV[2]: rate (tokens/sec)
                # ARGV[3]: now (seconds)
                # ARGV[4]: cost
                res = await redis_client.evalsha(
                    tpm_script_sha,
                    keys=[key],
                    args=[tpm_limit, tpm_rate, now_sec, cost],
                )
                # Returns: {allowed, tokens, retry_after}
            except Exception as e:
                logger.warning(f"TPM script failed: {e}")
            else:
                # res: [allowed, tokens, retry_after]
                if res and res[0] == 0: # Denied
                    retry_after = res[2] if len(res) > 2 else 60
                    raise RateLimitExceededError("tpm", tpm_limit, int(retry_after))

                tpm_remaining = int(res[1]) if res and len(res) > 1 else tpm_limit
        elif redis_client:
            # Lua 不可用时降级为 Redis Hash 令牌桶
            key = CacheKeys.rate_limit_tpm(rate_key, "chat")
            try:
                bucket = await redis_client.hgetall(key)
                tokens = float(bucket.get(b"tokens", 0)) if bucket else float(tpm_limit)
                last_update = float(bucket.get(b"last_update", now_sec)) if bucket else now_sec
                elapsed = max(0.0, now_sec - last_update)
                tokens = min(float(tpm_limit), tokens + elapsed * tpm_rate)
                if tokens < cost:
                    retry_after = int(((cost - tokens) / tpm_rate) + 0.999)
                    await redis_client.hset(key, mapping={"tokens": tokens, "last_update": now_sec})
                    await redis_client.expire(key, window_seconds + 1)
                    raise RateLimitExceededError("tpm", tpm_limit, retry_after)
                tokens -= cost
                await redis_client.hset(key, mapping={"tokens": tokens, "last_update": now_sec})
                await redis_client.expire(key, window_seconds + 1)
                tpm_remaining = int(tokens)
            except RateLimitExceededError:
                raise
            except Exception as exc:
                logger.warning(f"TPM fallback failed: {exc}")

        return {
            "rpm_limit": rpm_limit,
            "rpm_remaining": rpm_remaining,
            "tpm_limit": tpm_limit,
            "tpm_remaining": tpm_remaining,
            "reset_at": rpm_reset,
        }
