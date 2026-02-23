from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.semantic_kernel import SemanticKernelStep


@pytest.mark.asyncio
async def test_semantic_kernel_logs_disabled_reason(monkeypatch, caplog):
    step = SemanticKernelStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL, user_id="user-1")

    monkeypatch.setattr(
        "app.services.workflow.steps.semantic_kernel.qdrant_is_configured",
        lambda: False,
    )

    with caplog.at_level("INFO"):
        result = await step.execute(ctx)

    assert result.message == "qdrant_disabled"
    usage_logs = [
        record.message
        for record in caplog.records
        if "semantic_kernel_usage" in record.message
    ]
    assert usage_logs
    assert "reason=qdrant_disabled" in usage_logs[-1]
    assert "memory_used=False" in usage_logs[-1]
    assert "semantic_assistant_used=False" in usage_logs[-1]


@pytest.mark.asyncio
async def test_semantic_kernel_logs_memory_and_assistant(monkeypatch, caplog):
    step = SemanticKernelStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL, user_id="user-1")
    ctx.set(
        "validation",
        "request",
        SimpleNamespace(
            messages=[SimpleNamespace(role="user", content="check contract risks")]
        ),
    )

    monkeypatch.setattr(
        "app.services.workflow.steps.semantic_kernel.qdrant_is_configured",
        lambda: True,
    )
    monkeypatch.setattr(
        step,
        "_search_memories",
        AsyncMock(return_value=[{"id": "mem-1"}, {"id": "mem-2"}]),
    )
    monkeypatch.setattr(
        step,
        "_search_active_persona",
        AsyncMock(
            return_value={
                "assistant_id": "assistant-42",
                "name": "contract-review-assistant",
                "score": 0.93,
                "prompt": "system",
                "skill_tools": [],
            }
        ),
    )

    with caplog.at_level("INFO"):
        result = await step.execute(ctx)

    assert result.status.value == "success"
    usage_logs = [
        record.message
        for record in caplog.records
        if "semantic_kernel_usage" in record.message
    ]
    assert usage_logs
    assert "reason=perception_done" in usage_logs[-1]
    assert "memory_used=True" in usage_logs[-1]
    assert "memory_count=2" in usage_logs[-1]
    assert "semantic_assistant_used=True" in usage_logs[-1]
    assert "semantic_assistant_id=assistant-42" in usage_logs[-1]
