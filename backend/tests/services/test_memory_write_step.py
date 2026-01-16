import asyncio
import uuid

import pytest

from app.services.memory import external_memory
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.base import StepStatus
from app.services.workflow.steps.memory_write import MemoryWriteStep


class _DummyMessage:
    def __init__(self, role: str, content: object) -> None:
        self.role = role
        self.content = content


class _DummyRequest:
    def __init__(self, messages: list[_DummyMessage]) -> None:
        self.messages = messages


@pytest.mark.asyncio
async def test_memory_write_step_schedules_external(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {"count": 0}

    async def fake_persist(**kwargs) -> bool:
        called["count"] += 1
        return True

    monkeypatch.setattr(external_memory, "persist_external_memory", fake_persist)

    ctx = WorkflowContext(channel=Channel.EXTERNAL, capability="chat")
    ctx.set(
        "validation",
        "request",
        _DummyRequest([_DummyMessage("user", "我喜欢喝咖啡")]),
    )
    ctx.set("external_memory", "user_id", str(uuid.uuid4()))
    ctx.set("external_memory", "path", "/v1/chat/completions")
    ctx.set("upstream_call", "stream", False)

    loop = asyncio.get_running_loop()
    tasks: list[asyncio.Task] = []
    origin_create_task = loop.create_task

    def fake_create_task(coro):
        task = origin_create_task(coro)
        tasks.append(task)
        return task

    monkeypatch.setattr(loop, "create_task", fake_create_task)

    step = MemoryWriteStep()
    result = await step.execute(ctx)
    assert result.status == StepStatus.SUCCESS
    assert tasks
    await asyncio.gather(*tasks)
    assert called["count"] == 1


@pytest.mark.asyncio
async def test_memory_write_step_skip_internal() -> None:
    ctx = WorkflowContext(channel=Channel.INTERNAL, capability="chat")
    step = MemoryWriteStep()
    result = await step.execute(ctx)
    assert result.status == StepStatus.SUCCESS
