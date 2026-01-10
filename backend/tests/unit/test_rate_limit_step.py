from unittest.mock import AsyncMock

import pytest

from app.core.cache import cache
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.rate_limit import RateLimitStep


@pytest.fixture
def mock_cache(monkeypatch):
    mock_redis = AsyncMock()
    monkeypatch.setattr(cache, "_redis", mock_redis)
    # Mock get_script_sha to return SHAs
    monkeypatch.setattr(cache, "get_script_sha", lambda name: "sha_" + name)
    return mock_redis

@pytest.mark.asyncio
async def test_check_rate_limit_allows(mock_cache):
    step = RateLimitStep()
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        tenant_id="test_tenant",
        api_key_id="test_key"
    )
    # Mock routing config
    ctx.set("routing", "limit_config", {"rpm": 10, "tpm": 100})

    # Mock Redis responses
    # RPM: {1, remaining, reset}
    # TPM: {1, tokens, retry_after}
    mock_cache.evalsha.side_effect = [
        [1, 9, 60], # RPM
        [1, 100, 0] # TPM
    ]

    result = await step.execute(ctx)
    assert result.status.value == "success"
    assert result.data["rpm_remaining"] == 9
    assert result.data["tpm_remaining"] == 100
    assert mock_cache.evalsha.call_count == 2

@pytest.mark.asyncio
async def test_check_rate_limit_rpm_exceeded(mock_cache):
    step = RateLimitStep()
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        tenant_id="test_tenant"
    )
    ctx.set("routing", "limit_config", {"rpm": 10})

    # RPM exceeded: {0, remaining, retry_after}
    mock_cache.evalsha.side_effect = [
        [0, 0, 30]
    ]

    result = await step.execute(ctx)
    assert result.status.value == "failed"
    assert "rpm" in result.message
    assert result.data["retry_after"] == 30
    # Should not call TPM check
    assert mock_cache.evalsha.call_count == 1

@pytest.mark.asyncio
async def test_check_rate_limit_tpm_exceeded(mock_cache):
    step = RateLimitStep()
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        tenant_id="test_tenant"
    )
    ctx.set("routing", "limit_config", {"tpm": 10})

    # RPM allows, TPM exceeded
    mock_cache.evalsha.side_effect = [
        [1, 9, 60], # RPM
        [0, 0, 15]  # TPM exceeded
    ]

    result = await step.execute(ctx)
    assert result.status.value == "failed"
    assert "tpm" in result.message
    assert result.data["retry_after"] == 15
    assert mock_cache.evalsha.call_count == 2
