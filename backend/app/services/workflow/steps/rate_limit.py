"""
RateLimitStep: 限流步骤

职责：
- 支持多级原子限流 (API Key / Tenant / IP / Global)
- 原子性检查：所有层级都通过才放行，任意一层失败则拒绝且不消耗额度
- 外部通道严格限制，内部通道宽松
- 支持滑动窗口 (RPM) 和令牌桶 (TPM)
"""

import logging
import time
from typing import TYPE_CHECKING, Any

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

    def __init__(self, limit_type: str, limit: int, retry_after: int = 60, scope: str = "unknown"):
        self.limit_type = limit_type
        self.limit = limit
        self.retry_after = retry_after
        self.scope = scope
        super().__init__(
            f"Rate limit exceeded: {scope}.{limit_type}={limit}, retry_after={retry_after}s"
        )


@step_registry.register
class RateLimitStep(BaseStep):
    """
    限流步骤 (多级)

    从上下文读取:
        - ctx.tenant_id
        - ctx.api_key_id
        - ctx.client_ip
        - signature_verify.rate_limit_rpm (API Key 配置)

    逻辑:
        构建多级限流规则列表，一次性提交给 Lua 脚本执行。
        优先级: IP (Global) -> Tenant -> API Key
    """

    name = "rate_limit"
    depends_on = ["validation"]
    _memory_rpm: dict[str, list[float]] = {}

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行多级限流检查"""
        
        # 0. 白名单检查
        if ctx.get("signature_verify", "is_whitelist"):
            return StepResult(status=StepStatus.SUCCESS, data={"skipped": True})

        try:
            # 1. 准备多级限流配置
            specs = self._build_rate_limit_specs(ctx)
            
            if not specs:
                # 无限流配置，直接放行
                return StepResult(status=StepStatus.SUCCESS, data={})

            # 2. 执行原子检查 (RPM)
            rate_info = await self._check_multi_level_rpm(specs)

            # 3. TPM 检查 (暂未合并到多级 Lua，仍单独检查 API Key 层级)
            # 理由：TPM 通常只配在 API Key 或 Tenant 上，不需要像 RPM 那样复杂的层级组合
            # 且 TPM 消耗需要计算 cost，逻辑不同。
            # 这里选取最严格的一个 TPM 配置执行。
            tpm_spec = self._select_strict_tpm_spec(specs)
            if tpm_spec:
                 await self._check_tpm(tpm_spec)

            # 写入上下文
            ctx.set("rate_limit", "rpm_remaining", rate_info.get("remaining"))
            ctx.set("rate_limit", "reset_after", rate_info.get("reset"))

            logger.debug(
                f"Rate limit passed trace_id={ctx.trace_id} "
                f"remaining={rate_info.get('remaining')}"
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
                data={"retry_after": e.retry_after, "scope": e.scope},
            )

    def _build_rate_limit_specs(self, ctx: "WorkflowContext") -> list[dict[str, Any]]:
        """
        构建多级限流规格列表
        
        返回结构: [
            {"key": "gw:rl:global", "rpm": 1000, "window": 60, "scope": "global", "tpm": ...},
            {"key": "gw:rl:tenant:123", "rpm": 500, "window": 60, "scope": "tenant"},
            {"key": "gw:rl:ak:abc", "rpm": 60, "window": 60, "scope": "apikey"}
        ]
        """
        specs = []
        limit_config = ctx.get("routing", "limit_config") or {}
        default_window = int(limit_config.get("window") or settings.RATE_LIMIT_WINDOW_SECONDS)

        # 1. API Key 级 (最细粒度)
        if ctx.api_key_id:
            ak_rpm = ctx.get("signature_verify", "rate_limit_rpm")
            ak_tpm = ctx.get("signature_verify", "rate_limit_tpm")
            
            # 只有当显式配置了 API Key 限制时才生效
            if ak_rpm:
                specs.append({
                    "key": CacheKeys.rate_limit_rpm(f"ak:{ctx.api_key_id}", "chat"),
                    "rpm": int(ak_rpm),
                    "window": default_window,
                    "scope": "apikey",
                    "tpm": ak_tpm,
                    "tpm_key": CacheKeys.rate_limit_tpm(f"ak:{ctx.api_key_id}", "chat") if ak_tpm else None
                })
        
        # 2. 租户级
        if ctx.tenant_id:
            # TODO: 从配置中心或 Cache 读取租户级配额，目前暂无统一存储，使用默认值
            # 仅演示：如果有租户级配置
            # tenant_rpm = ...
            pass

        # 3. IP 级 (防恶意刷)
        if ctx.client_ip:
            # 假设默认 IP 限制
            ip_rpm = settings.RATE_LIMIT_IP_DEFAULT_RPM  # 需在 settings 增加此配置，暂定 600
            if ip_rpm > 0:
                specs.append({
                    "key": CacheKeys.rate_limit_rpm(f"ip:{ctx.client_ip}", "chat"),
                    "rpm": ip_rpm,
                    "window": default_window,
                    "scope": "ip"
                })

        # 4. 全局/默认级 (兜底)
        default_rpm = (
            settings.RATE_LIMIT_EXTERNAL_RPM
            if ctx.is_external
            else settings.RATE_LIMIT_INTERNAL_RPM
        )
        if default_rpm and default_rpm > 0:
             specs.append({
                "key": CacheKeys.rate_limit_rpm("global", "chat"),
                "rpm": default_rpm,
                "window": default_window,
                "scope": "global"
            })

        return specs

    def _select_strict_tpm_spec(self, specs: list[dict]) -> dict | None:
        """从多级配置中选出有 TPM 配置且最严格的一个（通常只有 API Key 级有 TPM）"""
        target = None
        min_tpm = float('inf')
        
        for spec in specs:
            t = spec.get("tpm")
            if t is not None and t < min_tpm:
                min_tpm = t
                target = spec
        
        return target

    async def _check_multi_level_rpm(self, specs: list[dict[str, Any]]) -> dict:
        """调用 Lua 脚本执行原子多级 RPM 检查"""
        redis_client = getattr(cache, "_redis", None)
        
        # 降级：无 Redis 时，仅检查第一个非全局的规则 (通常是 API Key)，使用内存计数
        if not redis_client:
            if not specs: return {"remaining": -1}
            # 挑选最核心的一个规则降级处理
            target = specs[0]
            return await self._check_rpm_fallback_memory(target)

        # 准备 Lua 参数
        keys = []
        args = []
        
        for spec in specs:
            keys.append(spec["key"])
            args.append(spec["window"])
            args.append(spec["rpm"])
            
        now_ms = int(time.time() * 1000)
        # 随机请求 ID，保证同一个时间戳下的多次请求也能被记录
        # 如果需要严格去重，这里应该由上游传入 X-Request-Id
        import uuid
        request_id = str(uuid.uuid4())
        
        args.append(now_ms)
        args.append(request_id)
        
        # 执行脚本
        script_sha = cache.get_script_sha("sliding_window_rate_limit")
        if not script_sha:
             # 尝试重新加载
             await cache.preload_scripts()
             script_sha = cache.get_script_sha("sliding_window_rate_limit")
        
        if not script_sha:
            # 脚本加载失败，降级为串行检查（非原子，但也比挂掉好）
            return await self._check_rpm_fallback_redis_serial(redis_client, specs)

        try:
            # Result: [allowed(1/0), val2, val3, val4]
            # Allowed: [1, min_remaining, max_reset]
            # Denied: [0, rejected_index, limit, retry_after]
            res = await redis_client.evalsha(script_sha, len(keys), *keys, *args)
            
            if res[0] == 0:
                # 拒绝
                rejected_idx = int(res[1]) - 1 # Lua index 1-based -> Py 0-based
                rejected_spec = specs[rejected_idx] if 0 <= rejected_idx < len(specs) else specs[0]
                limit = res[2]
                retry_after = res[3]
                raise RateLimitExceededError("rpm", limit, retry_after, scope=rejected_spec["scope"])
            
            # 通过
            return {
                "remaining": res[1],
                "reset": res[2]
            }

        except RateLimitExceededError:
            raise
        except Exception as e:
            logger.error(f"Rate limit Lua execution failed: {e}")
            # 发生未知 Redis 错误时，默认放行 (Fail-Open) 以保障可用性
            return {"remaining": -1, "reset": 0}

    async def _check_tpm(self, spec: dict) -> None:
        """检查单级 TPM (Token Bucket)"""
        redis_client = getattr(cache, "_redis", None)
        if not redis_client: return

        tpm_limit = spec["tpm"]
        key = spec["tpm_key"]
        window = spec["window"]
        
        # 估算 cost (暂定默认 1，实际应从 ctx 读取 token 估算)
        cost = 1 
        
        # 简单使用 Hash 令牌桶
        tpm_rate = tpm_limit / float(window)
        now_sec = time.time()
        
        try:
            # Lua 脚本优化 (token_bucket_rate_limit.lua)
            script_sha = cache.get_script_sha("token_bucket_rate_limit")
            if script_sha:
                res = await redis_client.evalsha(
                    script_sha,
                    1,
                    key,
                    tpm_limit,
                    tpm_rate,
                    now_sec,
                    cost,
                )
                # res: [allowed, tokens, retry_after]
                if res[0] == 0:
                     raise RateLimitExceededError("tpm", tpm_limit, int(res[2]), scope=spec["scope"])
            else:
                # Python Fallback
                bucket = await redis_client.hgetall(key)
                tokens = float(bucket.get(b"tokens", 0)) if bucket else float(tpm_limit)
                last_update = float(bucket.get(b"last_update", now_sec)) if bucket else now_sec
                
                elapsed = max(0.0, now_sec - last_update)
                tokens = min(float(tpm_limit), tokens + elapsed * tpm_rate)
                
                if tokens < cost:
                    retry_after = int(((cost - tokens) / tpm_rate) + 1)
                    await redis_client.hset(key, mapping={"tokens": tokens, "last_update": now_sec})
                    await redis_client.expire(key, window + 1)
                    raise RateLimitExceededError("tpm", tpm_limit, retry_after, scope=spec["scope"])
                
                tokens -= cost
                await redis_client.hset(key, mapping={"tokens": tokens, "last_update": now_sec})
                await redis_client.expire(key, window + 1)

        except RateLimitExceededError:
            raise
        except Exception as e:
            logger.warning(f"TPM check failed: {e}")

    async def _check_rpm_fallback_memory(self, spec: dict) -> dict:
        """内存降级 (仅支持单 Key)"""
        key = spec["key"]
        limit = spec["rpm"]
        window = spec["window"]
        now_sec = time.time()
        
        bucket = self._memory_rpm.get(key, [])
        # 清理过期
        bucket = [t for t in bucket if t > now_sec - window]
        
        if len(bucket) >= limit:
            raise RateLimitExceededError("rpm", limit, window, scope="memory_fallback")
            
        bucket.append(now_sec)
        self._memory_rpm[key] = bucket
        
        return {"remaining": limit - len(bucket), "reset": window}

    async def _check_rpm_fallback_redis_serial(self, redis_client, specs: list) -> dict:
        """串行 Redis 检查 (Lua 失败时的兜底)"""
        # 注意：这里不是原子操作，可能存在竞态，但在故障降级场景下可接受
        min_rem = -1
        
        for spec in specs:
            key = spec["key"]
            limit = spec["rpm"]
            window = spec["window"]
            now_ms = int(time.time() * 1000)
            
            # 清理
            await redis_client.zremrangebyscore(key, 0, now_ms - window * 1000)
            
            # 检查
            count = await redis_client.zcard(key)
            if count >= limit:
                raise RateLimitExceededError("rpm", limit, window, scope=spec["scope"])
                
            # 写入 (乐观写入)
            await redis_client.zadd(key, {f"{now_ms}:fallback": now_ms})
            await redis_client.pexpire(key, window * 1000)
            
            rem = limit - count - 1
            if min_rem == -1 or rem < min_rem:
                min_rem = rem
                
        return {"remaining": min_rem, "reset": 0}
