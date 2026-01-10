import pytest

from app.services.orchestrator.registry import StepNotFoundError, StepRegistry
from app.services.workflow.steps.base import BaseStep, StepConfig, StepResult, StepStatus


class _DummyStep(BaseStep):
    name = "dummy"

    async def execute(self, ctx) -> StepResult:  # pragma: no cover - not used
        return StepResult()


def _snapshot_registry(registry: StepRegistry):
    return dict(registry._steps)


@pytest.fixture()
def registry():
    reg = StepRegistry()
    original = _snapshot_registry(reg)
    reg.clear()
    try:
        yield reg
    finally:
        reg._steps = original


def test_register_and_get_step(registry: StepRegistry):
    @registry.register
    class MyStep(BaseStep):
        name = "my_step"

        async def execute(self, ctx) -> StepResult:
            return StepResult(status=StepStatus.SUCCESS, data={"ok": True})

    step = registry.get("my_step", StepConfig(timeout=3))
    assert isinstance(step, MyStep)
    assert step.config.timeout == 3
    assert "my_step" in registry
    assert len(registry) == 1
    assert registry.list_all() == ["my_step"]


def test_register_requires_name(registry: StepRegistry):
    class NoNameStep(BaseStep):
        name = ""

        async def execute(self, ctx) -> StepResult:
            return StepResult()

    with pytest.raises(ValueError):
        registry.register(NoNameStep)


def test_duplicate_register_raises(registry: StepRegistry):
    registry.register(_DummyStep)
    with pytest.raises(ValueError):
        registry.register(_DummyStep)


def test_get_missing_step_raises(registry: StepRegistry):
    with pytest.raises(StepNotFoundError):
        registry.get("not-exist")


def test_get_many_with_individual_configs(registry: StepRegistry):
    @registry.register
    class StepA(BaseStep):
        name = "a"

        async def execute(self, ctx) -> StepResult:
            return StepResult()

    @registry.register
    class StepB(BaseStep):
        name = "b"

        async def execute(self, ctx) -> StepResult:
            return StepResult()

    configs = {
        "a": StepConfig(timeout=1),
        "b": StepConfig(timeout=2),
    }
    steps = registry.get_many(["a", "b"], configs=configs)
    assert [s.name for s in steps] == ["a", "b"]
    assert steps[0].config.timeout == 1
    assert steps[1].config.timeout == 2


def test_singleton_identity():
    r1 = StepRegistry()
    r2 = StepRegistry()
    assert r1 is r2
