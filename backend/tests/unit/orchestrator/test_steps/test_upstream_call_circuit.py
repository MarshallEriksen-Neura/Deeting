"""
UpstreamCallStep 熔断状态 Redis 化测试
"""

import time
from unittest.mock import AsyncMock

import pytest

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.services.workflow.steps.upstream_call import UpstreamCallStep


@pytest.mark.asyncio
async def test_circuit_open_state_moves_to_half_open_after_reset_window():
    step = UpstreamCallStep()
    url = "https://api.example.com/chat"
    host = "api.example.com"
    opened_at = time.time() - (settings.CIRCUIT_BREAKER_RESET_SECONDS + 5)

    redis_mock = AsyncMock()
    redis_mock.hgetall.return_value = {
        b"state": b"open",
        b"failures": b"5",
        b"opened_at": str(opened_at).encode(),
        b"success_count": b"0",
    }

    original = getattr(cache, "_redis", None)
    cache._redis = redis_mock

    try:
        is_open = await step._is_circuit_open(url)
    finally:
        cache._redis = original

    expected_key = f"{settings.CACHE_PREFIX}{CacheKeys.circuit_breaker(host)}"
    redis_mock.hgetall.assert_awaited_once_with(expected_key)
    redis_mock.hset.assert_awaited()
    redis_mock.expire.assert_awaited_with(expected_key, settings.CIRCUIT_BREAKER_RESET_SECONDS * 2)
    assert is_open is False
