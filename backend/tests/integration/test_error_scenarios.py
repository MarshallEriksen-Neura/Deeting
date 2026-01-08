import pytest

from app.services.orchestrator.config import WorkflowConfig, WorkflowTemplate
from app.services.orchestrator.context import Channel, ErrorSource, WorkflowContext
from app.services.orchestrator.engine import StepExecutionError
from app.services.orchestrator.orchestrator import GatewayOrchestrator
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus


class FailingStep(BaseStep):
    name = "failing"
    depends_on: list[str] = []

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        raise RuntimeError("boom")


class SkipThenSuccessStep(BaseStep):
    name = "secondary"
    depends_on = ["failing"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        return StepResult(status=StepStatus.SUCCESS, data={"ok": True})


@pytest.mark.asyncio
async def test_orchestrator_returns_error_on_step_failure():
    workflow = WorkflowConfig(
        template=WorkflowTemplate.EXTERNAL_CHAT,
        steps=["failing"],
    )
    orchestrator = GatewayOrchestrator(
        workflow_config=workflow,
        custom_steps=[FailingStep()],
    )
    ctx = WorkflowContext(channel=Channel.EXTERNAL, capability="chat")

    result = await orchestrator.execute(ctx)

    assert result.success is False
    assert isinstance(result.error, StepExecutionError)
    assert result.step_results["failing"].status == StepStatus.FAILED
    assert ctx.error_source == ErrorSource.GATEWAY
    assert ctx.error_code == "FAILING_FAILED"


@pytest.mark.asyncio
async def test_orchestrator_stops_after_failure_and_does_not_run_dependents():
    workflow = WorkflowConfig(
        template=WorkflowTemplate.EXTERNAL_CHAT,
        steps=["failing", "secondary"],
    )
    orchestrator = GatewayOrchestrator(
        workflow_config=workflow,
        custom_steps=[FailingStep(), SkipThenSuccessStep()],
    )
    ctx = WorkflowContext(channel=Channel.EXTERNAL, capability="chat")

    result = await orchestrator.execute(ctx)

    assert result.success is False
    assert "secondary" not in ctx.executed_steps
