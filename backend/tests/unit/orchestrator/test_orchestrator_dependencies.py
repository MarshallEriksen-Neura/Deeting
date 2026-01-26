import pytest

from app.services.orchestrator.config import WorkflowConfig, WorkflowTemplate
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import GatewayOrchestrator
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus


class AgentExecutorStub(BaseStep):
    name = "agent_executor"

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        return StepResult(status=StepStatus.SUCCESS)


class ProviderExecutionStub(BaseStep):
    name = "provider_execution"

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        return StepResult(status=StepStatus.SUCCESS)


class ResponseTransformStub(BaseStep):
    name = "response_transform"
    depends_on = ["upstream_call"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        return StepResult(status=StepStatus.SUCCESS)


def test_response_transform_depends_on_agent_executor():
    workflow = WorkflowConfig(
        template=WorkflowTemplate.INTERNAL_CHAT,
        steps=["agent_executor", "response_transform"],
    )
    orchestrator = GatewayOrchestrator(
        workflow_config=workflow,
        custom_steps=[AgentExecutorStub(), ResponseTransformStub()],
    )

    engine = orchestrator._build_engine(WorkflowContext(channel=Channel.INTERNAL))
    assert engine.steps["response_transform"].depends_on == ["agent_executor"]


def test_response_transform_depends_on_provider_execution():
    workflow = WorkflowConfig(
        template=WorkflowTemplate.INTERNAL_IMAGE,
        steps=["provider_execution", "response_transform"],
    )
    orchestrator = GatewayOrchestrator(
        workflow_config=workflow,
        custom_steps=[ProviderExecutionStub(), ResponseTransformStub()],
    )

    engine = orchestrator._build_engine(WorkflowContext(channel=Channel.INTERNAL))
    assert engine.steps["response_transform"].depends_on == ["provider_execution"]
