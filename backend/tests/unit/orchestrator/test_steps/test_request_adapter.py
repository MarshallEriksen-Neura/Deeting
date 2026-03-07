from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.base import StepStatus
from app.services.workflow.steps.request_adapter import RequestAdapterStep


@pytest.mark.asyncio
async def test_request_adapter_stores_legacy_and_canonical_chat_request():
    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        capability="chat",
        db_session=AsyncMock(spec=AsyncSession),
    )
    ctx.set(
        "validation",
        "request",
        {
            "model": "gpt-5.3-codex",
            "messages": [{"role": "user", "content": "hello"}],
            "max_tokens": 256,
        },
    )

    step = RequestAdapterStep()
    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    legacy = ctx.get("validation", "request")
    canonical = ctx.get("protocol", "canonical_request")
    assert legacy.model == "gpt-5.3-codex"
    assert canonical.model == "gpt-5.3-codex"
    assert canonical.max_output_tokens == 256
    assert canonical.messages[0].content == "hello"


@pytest.mark.asyncio
async def test_request_adapter_supports_responses_vendor_into_canonical_request():
    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        capability="chat",
        db_session=AsyncMock(spec=AsyncSession),
    )
    ctx.set("adapter", "vendor", "responses")
    ctx.set(
        "adapter",
        "raw_request",
        {
            "model": "gpt-5.3-codex",
            "input": [{"type": "input_text", "text": "hello from responses"}],
            "system": "be precise",
            "max_output_tokens": 128,
        },
    )

    step = RequestAdapterStep()
    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    legacy = ctx.get("validation", "request")
    canonical = ctx.get("protocol", "canonical_request")
    user_message = next(message for message in legacy.messages if message.role == "user")
    assert "hello from responses" in str(user_message.content)
    assert canonical.instructions == "be precise"
    assert canonical.input_items[0].text == "hello from responses"
    assert canonical.max_output_tokens == 128
