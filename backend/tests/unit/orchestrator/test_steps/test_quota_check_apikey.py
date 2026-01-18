from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.api_key import ApiKeyQuota, QuotaType
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
    ctx.get = MagicMock(return_value=None)
    return ctx


@pytest.mark.asyncio
async def test_apikey_budget_limit_exceeded(mock_ctx):
    step = QuotaCheckStep()
    mock_repo = MagicMock()
    mock_repo.get_by_id = AsyncMock(return_value=MagicMock(quotas=[]))
    step.apikey_repo = mock_repo

    def _ctx_get(ns, key):
        if ns == "external_auth" and key == "budget_limit":
            return 10
        return None

    mock_ctx.get.side_effect = _ctx_get

    step._get_apikey_budget_used = AsyncMock(return_value=10.0)
    result = await step.execute(mock_ctx)

    assert result.status == StepStatus.FAILED
    mock_ctx.mark_error.assert_called_once()


@pytest.mark.asyncio
async def test_apikey_request_quota_exceeded(mock_ctx):
    step = QuotaCheckStep()
    quota = ApiKeyQuota(
        api_key_id=uuid4(),
        quota_type=QuotaType.REQUEST,
        total_quota=10,
        used_quota=10,
    )
    mock_repo = MagicMock()
    mock_repo.get_by_id = AsyncMock(return_value=MagicMock(quotas=[quota]))
    step.apikey_repo = mock_repo

    result = await step.execute(mock_ctx)

    assert result.status == StepStatus.FAILED
    mock_ctx.mark_error.assert_called_once()


@pytest.mark.asyncio
async def test_apikey_quota_pass(mock_ctx):
    step = QuotaCheckStep()
    quota = ApiKeyQuota(
        api_key_id=uuid4(),
        quota_type=QuotaType.REQUEST,
        total_quota=10,
        used_quota=1,
    )
    mock_repo = MagicMock()
    mock_repo.get_by_id = AsyncMock(return_value=MagicMock(quotas=[quota]))
    step.apikey_repo = mock_repo

    result = await step.execute(mock_ctx)

    assert result.status == StepStatus.SUCCESS
    mock_ctx.mark_error.assert_not_called()
