"""
RateLimitStep 测试

覆盖点：
- 当预加载的 Lua 脚本存在时，执行路径应调用 evalsha
- 未超限时返回 SUCCESS 并写入剩余额度
"""

from unittest.mock import AsyncMock

import pytest

from app.core.cache import cache
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.base import StepStatus
from app.services.workflow.steps.rate_limit import RateLimitStep


@pytest.mark.asyncio
async def test_rate_limit_uses_preloaded_lua_sha():
    step = RateLimitStep()
    ctx = WorkflowContext(trace_id="trace-test", channel=Channel.EXTERNAL)
    ctx.api_key_id = "ak-123"
    ctx.set("routing", "limit_config", {"rpm": 5})
    ctx.set("signature_verify", "is_whitelist", False)

    redis_mock = AsyncMock()
    redis_mock.evalsha.return_value = [1, 3, 60]

    # 备份并注入模拟的 redis 与脚本 SHA
    original_redis = getattr(cache, "_redis", None)
    original_scripts = dict(getattr(cache, "_script_sha", {}))
    cache._redis = redis_mock
    cache._script_sha = {
        "sliding_window_rate_limit": "sha-test",
        "token_bucket_rate_limit": "sha-tpm",
    }

    try:
        result = await step.execute(ctx)
    finally:
        cache._redis = original_redis
        cache._script_sha = original_scripts

    redis_mock.evalsha.assert_awaited_once()
    assert result.status == StepStatus.SUCCESS
    assert ctx.get("rate_limit", "rpm_remaining") == 3


@pytest.mark.asyncio
async def test_rate_limit_whitelist_bypass_redis():
    step = RateLimitStep()
    ctx = WorkflowContext(trace_id="trace-wl", channel=Channel.EXTERNAL)
    ctx.api_key_id = "ak-123"
    ctx.set("routing", "limit_config", {})
    ctx.set("signature_verify", "is_whitelist", True)

    redis_mock = AsyncMock()

    original_redis = getattr(cache, "_redis", None)
    original_scripts = dict(getattr(cache, "_script_sha", {}))
    cache._redis = redis_mock
    cache._script_sha = {
        "sliding_window_rate_limit": "sha-test",
        "token_bucket_rate_limit": "sha-tpm",
    }

    try:
        result = await step.execute(ctx)
    finally:
        cache._redis = original_redis
        cache._script_sha = original_scripts

    redis_mock.evalsha.assert_not_awaited()
    assert result.status == StepStatus.SUCCESS
    assert ctx.get("rate_limit", "rpm_remaining") > 0
    assert ctx.get("rate_limit", "tpm_remaining") > 0


@pytest.mark.asyncio
async def test_rate_limit_tpm_exceeded_returns_failed():
    step = RateLimitStep()
    ctx = WorkflowContext(trace_id="trace-tpm", channel=Channel.EXTERNAL)
    ctx.api_key_id = "ak-123"
    ctx.set("routing", "limit_config", {"rpm": 5, "tpm": 10})
    ctx.set("signature_verify", "is_whitelist", False)
    ctx.set("validation", "validated", {"max_tokens": 20})

    redis_mock = AsyncMock()
    # rpm allowed, tpm denied
    redis_mock.evalsha.side_effect = [
        [1, 3, 60],  # rpm
        [0, 0, 5],   # tpm denied with retry_after=5
    ]

    original_redis = getattr(cache, "_redis", None)
    original_scripts = dict(getattr(cache, "_script_sha", {}))
    cache._redis = redis_mock
    cache._script_sha = {
        "sliding_window_rate_limit": "sha-test",
        "token_bucket_rate_limit": "sha-tpm",
    }

    try:
        result = await step.execute(ctx)
    finally:
        cache._redis = original_redis
        cache._script_sha = original_scripts

    assert redis_mock.evalsha.await_count == 2
    assert result.status == StepStatus.FAILED
    assert ctx.get("rate_limit", "retry_after") == 5
