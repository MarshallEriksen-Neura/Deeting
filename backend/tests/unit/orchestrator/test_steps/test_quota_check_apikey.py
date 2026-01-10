from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.models.api_key import ApiKey, ApiKeyQuota, QuotaResetPeriod, QuotaType
from app.services.workflow.steps.base import StepStatus
from app.services.workflow.steps.quota_check import QuotaCheckStep


@pytest.fixture
def mock_ctx():
    ctx = MagicMock()
    ctx.tenant_id = None
    ctx.api_key_id = uuid4()
    ctx.is_external = True
    ctx.db_session = MagicMock()
    ctx.trace_id = "test-trace"
    ctx.set = MagicMock()
    ctx.mark_error = MagicMock()
    return ctx

@pytest.fixture
def mock_redis():
    with patch("app.core.cache.cache._redis", new_callable=AsyncMock) as mock:
        yield mock

@pytest.fixture
def mock_cache_sha():
    with patch("app.core.cache.cache.get_script_sha") as mock:
        mock.return_value = "sha-apikey-quota"
        yield mock

@pytest.mark.asyncio
async def test_apikey_quota_check_redis_hit(mock_ctx, mock_redis, mock_cache_sha):
    """测试 Redis 命中时的 API Key 配额检查"""
    mock_redis.exists.return_value = True
    # Lua 返回: [1, "OK"]
    mock_redis.evalsha.return_value = [1, "OK"]

    step = QuotaCheckStep()
    result = await step.execute(mock_ctx)

    assert result.status == StepStatus.SUCCESS
    mock_redis.evalsha.assert_called_once()
    # 验证是否生成了正确的 Key
    cache_key = mock_redis.evalsha.call_args[1]['keys'][0]
    assert str(mock_ctx.api_key_id) in cache_key

@pytest.mark.asyncio
async def test_apikey_quota_check_exceeded(mock_ctx, mock_redis, mock_cache_sha):
    """测试配额超限"""
    mock_redis.exists.return_value = True
    # Lua 返回: [0, "QUOTA_EXCEEDED", "token", 1000, 1001]
    mock_redis.evalsha.return_value = [0, "QUOTA_EXCEEDED", "token", 1000, 1001]

    step = QuotaCheckStep()
    result = await step.execute(mock_ctx)

    assert result.status == StepStatus.FAILED
    assert "token" in result.message
    mock_ctx.mark_error.assert_called_once()

@pytest.mark.asyncio
async def test_apikey_quota_warmup(mock_ctx, mock_redis, mock_cache_sha):
    """测试 Redis 未命中时的预热逻辑"""
    mock_redis.exists.return_value = False
    mock_redis.evalsha.return_value = [1, "OK"]

    # Mock Repository
    mock_repo = MagicMock()

    api_key_obj = MagicMock(spec=ApiKey)
    quota = ApiKeyQuota(
        quota_type=QuotaType.TOKEN,
        total_quota=5000,
        used_quota=100,
        reset_period=QuotaResetPeriod.MONTHLY
    )
    api_key_obj.quotas = [quota]

    mock_repo.get_by_id = AsyncMock(return_value=api_key_obj)

    with patch("app.services.workflow.steps.quota_check.ApiKeyRepository", return_value=mock_repo):
        step = QuotaCheckStep()
        result = await step.execute(mock_ctx)

        assert result.status == StepStatus.SUCCESS
        # 验证是否调用了 hset 进行预热
        mock_redis.hset.assert_called_once()
        _, kwargs = mock_redis.hset.call_args
        mapping = kwargs['mapping']
        assert mapping['token:limit'] == 5000
        assert mapping['token:used'] == 100
        assert mapping['token:period'] == QuotaResetPeriod.MONTHLY
