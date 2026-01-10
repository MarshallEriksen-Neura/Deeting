import pytest

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.base import StepResult, StepStatus
from app.services.workflow.steps.validation import ValidationStep


class _FakeRequest:
    def __init__(self, model: str | None = "gpt-4", payload: dict | None = None):
        self.model = model
        self.payload = payload or {"messages": [{"role": "user", "content": "hi"}]}

    def model_dump(self):
        return {"model": self.model, **self.payload}


@pytest.mark.asyncio
async def test_validation_success_with_model_extraction():
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    ctx.set("validation", "request", _FakeRequest())

    step = ValidationStep()
    result = await step.execute(ctx)

    assert isinstance(result, StepResult)
    assert result.status == StepStatus.SUCCESS
    assert ctx.get("validation", "validated")["model"] == "gpt-4"
    assert ctx.requested_model == "gpt-4"


@pytest.mark.asyncio
async def test_validation_missing_request_fails():
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    step = ValidationStep()

    result = await step.execute(ctx)

    assert result.status == StepStatus.FAILED
    assert "No request" in (result.message or "")


@pytest.mark.asyncio
async def test_validation_empty_model_fails():
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    ctx.set("validation", "request", _FakeRequest(model=""))
    step = ValidationStep()

    result = await step.execute(ctx)

    assert result.status == StepStatus.FAILED
    assert "Model is required" in (result.message or "")
