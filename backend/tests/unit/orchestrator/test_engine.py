import asyncio

import pytest

from app.services.orchestrator.context import Channel, ErrorSource, WorkflowContext
from app.services.orchestrator.engine import (
    CyclicDependencyError,
    OrchestrationEngine,
    StepExecutionError,
)
from app.services.workflow.steps.base import (
    BaseStep,
    FailureAction,
    StepConfig,
    StepResult,
    StepStatus,
)


class SuccessfulStep(BaseStep):
    name = "success"

    def __init__(self, name: str, depends_on=None, duration_ms: float = 0.0):
        super().__init__()
        self.name = name
        self.depends_on = depends_on or []
        self._duration_ms = duration_ms

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        if self._duration_ms:
            await asyncio.sleep(self._duration_ms / 1000)
        return StepResult(status=StepStatus.SUCCESS, data={"step": self.name})


class SkippedStep(BaseStep):
    name = "skipped"

    def __init__(self, name: str, skip_channels=None):
        config = StepConfig()
        config.skip_on_channels = skip_channels or []
        super().__init__(config)
        self.name = name

    async def execute(self, ctx: WorkflowContext) -> StepResult:  # pragma: no cover - execute 不会被调用
        return StepResult()


class RetryStep(BaseStep):
    name = "retry"

    def __init__(self, fail_times: int):
        super().__init__(StepConfig(max_retries=fail_times, retry_delay=0, retry_backoff=1))
        self.fail_times = fail_times
        self.calls = 0

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        self.calls += 1
        if self.calls <= self.fail_times:
            raise RuntimeError("temporary error")
        return StepResult(status=StepStatus.SUCCESS, message="recovered")

    async def on_failure(self, ctx, error: Exception, attempt: int) -> FailureAction:
        return FailureAction.RETRY


class DegradeStep(BaseStep):
    name = "degrade"

    def __init__(self):
        super().__init__(StepConfig(max_retries=0))

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        raise RuntimeError("boom")

    async def on_failure(self, ctx, error: Exception, attempt: int) -> FailureAction:
        return FailureAction.DEGRADE

    async def on_degrade(self, ctx: WorkflowContext, error: Exception) -> StepResult:
        return StepResult(status=StepStatus.DEGRADED, message="fallback")


class AbortStep(BaseStep):
    name = "abort"

    def __init__(self):
        super().__init__(StepConfig(max_retries=0))

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        raise RuntimeError("fatal")


def test_validate_dag_unknown_dependency():
    step_with_missing_dep = SuccessfulStep("b", depends_on=["missing"])
    with pytest.raises(ValueError):
        OrchestrationEngine([step_with_missing_dep])


def test_validate_dag_cycle_detection():
    a = SuccessfulStep("a", depends_on=["c"])
    b = SuccessfulStep("b", depends_on=["a"])
    c = SuccessfulStep("c", depends_on=["b"])
    with pytest.raises(CyclicDependencyError):
        OrchestrationEngine([a, b, c])


def test_get_execution_layers_topology():
    a = SuccessfulStep("a")
    b = SuccessfulStep("b", depends_on=["a"])
    c = SuccessfulStep("c", depends_on=["a"])
    d = SuccessfulStep("d", depends_on=["b", "c"])

    engine = OrchestrationEngine([a, b, c, d])
    layers = engine._get_execution_layers()

    assert layers[0] == ["a"]
    assert set(layers[1]) == {"b", "c"}
    assert layers[2] == ["d"]


@pytest.mark.asyncio
async def test_execute_success_and_skip():
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    success = SuccessfulStep("validation")
    skipped = SkippedStep("quota", skip_channels=["external"])
    engine = OrchestrationEngine([success, skipped])

    result = await engine.execute(ctx)

    assert result.success is True
    assert result.step_results["validation"].status == StepStatus.SUCCESS
    assert result.step_results["quota"].status == StepStatus.SKIPPED
    assert ctx.executed_steps == ["validation"]


@pytest.mark.asyncio
async def test_execute_retry_until_success():
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    retry_step = RetryStep(fail_times=1)
    engine = OrchestrationEngine([retry_step])

    result = await engine.execute(ctx)

    assert result.success is True
    assert retry_step.calls == 2
    assert result.step_results["retry"].status == StepStatus.SUCCESS
    assert "retry" in ctx.executed_steps


@pytest.mark.asyncio
async def test_execute_degrade_path():
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    step = DegradeStep()
    engine = OrchestrationEngine([step])

    result = await engine.execute(ctx)

    assert result.success is True
    assert result.step_results["degrade"].status == StepStatus.DEGRADED
    assert ctx.executed_steps == ["degrade"]


@pytest.mark.asyncio
async def test_execute_abort_sets_error():
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    step = AbortStep()
    engine = OrchestrationEngine([step])

    result = await engine.execute(ctx)

    assert result.success is False
    assert isinstance(result.error, StepExecutionError)
    assert result.step_results["abort"].status == StepStatus.FAILED
    assert ctx.error_source == ErrorSource.GATEWAY
    assert ctx.error_code == "ABORT_FAILED"
