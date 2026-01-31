from types import SimpleNamespace

import pytest

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.jit_persona_tool_injection import (
    JitPersonaToolInjectionStep,
)


@pytest.fixture
def ctx_factory():
    def _factory(*, assistant_id: str | None, session_assistant_id: str | None) -> WorkflowContext:
        ctx = WorkflowContext(channel=Channel.INTERNAL)
        ctx.set(
            "validation",
            "request",
            SimpleNamespace(
                assistant_id=assistant_id,
                session_assistant_id=session_assistant_id,
            ),
        )
        if session_assistant_id:
            ctx.set("conversation", "session_assistant_id", session_assistant_id)
        return ctx

    return _factory


@pytest.mark.asyncio
async def test_injects_tool_when_no_assistant_id(ctx_factory):
    ctx = ctx_factory(assistant_id=None, session_assistant_id=None)
    step = JitPersonaToolInjectionStep()
    await step.execute(ctx)
    tools = ctx.get("mcp_discovery", "tools") or []
    assert any(t.name == "consult_expert_network" for t in tools)


@pytest.mark.asyncio
async def test_skips_tool_when_assistant_locked(ctx_factory):
    ctx = ctx_factory(assistant_id="uuid", session_assistant_id="uuid")
    step = JitPersonaToolInjectionStep()
    await step.execute(ctx)
    tools = ctx.get("mcp_discovery", "tools") or []
    assert all(t.name != "consult_expert_network" for t in tools)
