import pytest

from app.services.orchestrator.config import WorkflowConfig, WorkflowTemplate
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import GatewayOrchestrator
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus


class LoadConversationStub(BaseStep):
    name = "conversation_load"
    depends_on = ["validation"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        ctx.set("conversation", "history", ["hi"])
        return StepResult(status=StepStatus.SUCCESS, data={"loaded": True})


class AppendConversationStub(BaseStep):
    name = "conversation_append"
    depends_on = ["response_transform"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        history = ctx.get("conversation", "history", [])
        history.append("assistant: ok")
        ctx.set("conversation", "history", history)
        return StepResult(status=StepStatus.SUCCESS, data={"length": len(history)})


class TransformStub(BaseStep):
    name = "response_transform"
    depends_on = ["upstream_call"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        ctx.set("response_transform", "response", {"content": "ok"})
        return StepResult(status=StepStatus.SUCCESS)


class InternalValidationStub(BaseStep):
    name = "validation"
    depends_on = []

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        ctx.set("validation", "model", ctx.requested_model)
        return StepResult(status=StepStatus.SUCCESS)


class RoutingStub(BaseStep):
    name = "routing"
    depends_on = ["validation"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        ctx.selected_upstream = "http://internal-upstream"
        return StepResult(status=StepStatus.SUCCESS)


class UpstreamStub(BaseStep):
    name = "upstream_call"
    depends_on = ["routing"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        ctx.upstream_result.provider = "internal-stub"
        ctx.upstream_result.status_code = 200
        return StepResult(status=StepStatus.SUCCESS)


@pytest.mark.asyncio
async def test_internal_flow_success_chain():
    workflow = WorkflowConfig(
        template=WorkflowTemplate.INTERNAL_CHAT,
        steps=[
            "validation",
            "conversation_load",
            "routing",
            "upstream_call",
            "response_transform",
            "conversation_append",
        ],
    )
    orchestrator = GatewayOrchestrator(
        workflow_config=workflow,
        custom_steps=[
            InternalValidationStub(),
            LoadConversationStub(),
            RoutingStub(),
            UpstreamStub(),
            TransformStub(),
            AppendConversationStub(),
        ],
    )

    ctx = WorkflowContext(channel=Channel.INTERNAL, capability="chat", requested_model="gpt-3.5")

    result = await orchestrator.execute(ctx)

    assert result.success is True
    assert ctx.is_internal is True
    assert ctx.selected_upstream == "http://internal-upstream"
    assert ctx.get("conversation", "history")[-1] == "assistant: ok"
    assert ctx.executed_steps == [
        "validation",
        "conversation_load",
        "routing",
        "upstream_call",
        "response_transform",
        "conversation_append",
    ]
