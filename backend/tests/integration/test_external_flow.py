import pytest

from app.services.orchestrator.config import WorkflowConfig, WorkflowTemplate
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import GatewayOrchestrator
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus


class ValidationStub(BaseStep):
    name = "validation"
    depends_on: list[str] = []

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        ctx.set("validation", "validated", {"model": ctx.requested_model})
        ctx.set("validation", "model", ctx.requested_model)
        return StepResult(status=StepStatus.SUCCESS, data={"model": ctx.requested_model})


class RoutingStub(BaseStep):
    name = "routing"
    depends_on = ["validation"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        upstream_url = "https://stub-upstream.test/chat"
        ctx.set("routing", "upstream_url", upstream_url)
        ctx.selected_upstream = upstream_url
        ctx.selected_preset_id = 1
        ctx.selected_preset_item_id = 2
        return StepResult(status=StepStatus.SUCCESS, data={"upstream_url": upstream_url})


class UpstreamStub(BaseStep):
    name = "upstream_call"
    depends_on = ["routing"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        ctx.upstream_result.provider = "stub"
        ctx.upstream_result.status_code = 200
        ctx.upstream_result.model = ctx.requested_model
        return StepResult(status=StepStatus.SUCCESS, data={"choices": [{"message": {"content": "ok"}}]})


class BillingStub(BaseStep):
    name = "billing"
    depends_on = ["upstream_call"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        ctx.billing.input_tokens = 10
        ctx.billing.output_tokens = 5
        ctx.billing.total_cost = 0.01
        return StepResult(status=StepStatus.SUCCESS, data={"billed": True})


@pytest.mark.asyncio
async def test_external_flow_full_success():
    workflow = WorkflowConfig(
        template=WorkflowTemplate.EXTERNAL_CHAT,
        steps=["validation", "routing", "upstream_call", "billing"],
    )
    orchestrator = GatewayOrchestrator(
        workflow_config=workflow,
        custom_steps=[
            ValidationStub(),
            RoutingStub(),
            UpstreamStub(),
            BillingStub(),
        ],
    )

    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability="chat",
        requested_model="gpt-4",
    )

    result = await orchestrator.execute(ctx)

    assert result.success is True
    assert ctx.selected_upstream == "https://stub-upstream.test/chat"
    assert ctx.upstream_result.provider == "stub"
    assert ctx.billing.total_cost == 0.01
    assert set(result.step_results.keys()) == {"validation", "routing", "upstream_call", "billing"}
    assert ctx.executed_steps == ["validation", "routing", "upstream_call", "billing"]
