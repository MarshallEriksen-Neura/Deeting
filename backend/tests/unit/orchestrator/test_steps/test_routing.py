from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.base import FailureAction, StepStatus
from app.services.workflow.steps.routing import RoutingStep


def _fake_routing_result():
    return (
        {
            "preset_id": 1,
            "preset_item_id": 11,
            "upstream_url": "https://api.fake.com",
            "provider": "fake",
            "template_engine": "simple_replace",
            "request_template": {"model": None},
            "response_transform": {},
            "pricing_config": {"input_per_1k": 0.1, "output_per_1k": 0.2},
            "limit_config": {"rpm": 10, "tpm": 1000},
            "auth_type": "api_key",
            "auth_config": {"header": "Authorization"},
            "default_headers": {"User-Agent": "test"},
            "default_params": {},
            "routing_config": {},
            "weight": 1,
            "priority": 1,
        },
        [],
        False,
    )


@pytest.mark.asyncio
async def test_routing_success_populates_context(monkeypatch):
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        requested_model="gpt-4",
        db_session=AsyncMock(spec=AsyncSession),
    )
    step = RoutingStep()
    monkeypatch.setattr(step, "_select_upstream", AsyncMock(return_value=_fake_routing_result()))

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    assert ctx.selected_upstream == "https://api.fake.com"
    assert ctx.get("routing", "preset_id") == 1
    assert ctx.get("routing", "candidates")[0]["provider"] == "fake"
    assert ctx.routing_weight == 1


@pytest.mark.asyncio
async def test_routing_with_provider_model_id(monkeypatch):
    class DummyRequest:
        def __init__(self):
            self.model = "gpt-4"
            self.provider_model_id = "11111111-1111-1111-1111-111111111111"

    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        requested_model="gpt-4",
        db_session=AsyncMock(spec=AsyncSession),
    )
    ctx.set("validation", "request", DummyRequest())

    step = RoutingStep()
    monkeypatch.setattr(step, "_select_by_provider_model_id", AsyncMock(return_value=_fake_routing_result()))

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    assert ctx.selected_upstream == "https://api.fake.com"


@pytest.mark.asyncio
async def test_routing_requires_model_and_db():
    step = RoutingStep()

    ctx_no_model = WorkflowContext(channel=Channel.EXTERNAL, db_session=AsyncMock(spec=AsyncSession))
    result = await step.execute(ctx_no_model)
    assert result.status == StepStatus.FAILED

    ctx_no_db = WorkflowContext(channel=Channel.EXTERNAL, requested_model="gpt-3.5")
    result = await step.execute(ctx_no_db)
    assert result.status == StepStatus.FAILED


def test_routing_on_failure_retries_once():
    step = RoutingStep()
    assert step.on_failure(None, RuntimeError(), attempt=1) == FailureAction.RETRY
    assert step.on_failure(None, RuntimeError(), attempt=2) == FailureAction.ABORT
