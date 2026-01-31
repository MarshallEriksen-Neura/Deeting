from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.assistant_prompt_injection import AssistantPromptInjectionStep


@pytest.mark.asyncio
async def test_prompt_injection_skips_without_assistant_id():
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set("validation", "request", SimpleNamespace(assistant_id=None))
    emitted: list[dict] = []
    ctx.status_emitter = emitted.append

    step = AssistantPromptInjectionStep()
    result = await step.execute(ctx)

    assert result.status.value == "success"
    assert result.message == "no_assistant_id"
    assert emitted == []


@pytest.mark.asyncio
async def test_prompt_injection_emits_selected_assistant(monkeypatch):
    assistant_id = "assistant-123"
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set("validation", "request", SimpleNamespace(assistant_id=assistant_id))
    emitted: list[dict] = []
    ctx.status_emitter = emitted.append

    step = AssistantPromptInjectionStep()
    monkeypatch.setattr(
        step,
        "_load_assistant_prompt_info",
        AsyncMock(return_value=("system prompt", "Helper Bot")),
    )

    result = await step.execute(ctx)

    assert result.status.value == "success"
    assert emitted
    payload = emitted[-1]
    assert payload["code"] == "assistant.selected"
    assert payload["meta"]["assistant_id"] == assistant_id
    assert payload["meta"]["assistant_name"] == "Helper Bot"
