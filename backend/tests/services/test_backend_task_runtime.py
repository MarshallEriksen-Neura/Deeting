import types

import pytest

from app.services.skill_registry.runtimes.backend_task import BackendTaskRuntimeStrategy
from app.services.skill_registry.runtimes.base import RuntimeContext


class _FakeAsyncResult:
    def __init__(self, captured: dict):
        self._captured = captured

    def get(self, timeout: int):
        self._captured["timeout"] = timeout
        return {"status": "ok"}


class _FakeCeleryTask:
    def __init__(self, captured: dict):
        self._captured = captured

    def apply_async(self, kwargs: dict):
        self._captured["apply_async_kwargs"] = kwargs
        return _FakeAsyncResult(self._captured)

    def delay(self, **kwargs):
        self._captured["delay_kwargs"] = kwargs
        return types.SimpleNamespace(id="task-1")


class _FailingCeleryTask(_FakeCeleryTask):
    def apply_async(self, kwargs: dict):
        self._captured["apply_async_kwargs"] = kwargs
        raise RuntimeError("worker failed")


@pytest.mark.asyncio
async def test_backend_task_runtime_filters_reserved_kwargs_for_wait_path(monkeypatch):
    captured: dict = {}
    fake_task = _FakeCeleryTask(captured)
    fake_module = types.SimpleNamespace(run_onboarding=fake_task)

    def _fake_import_module(_module_path: str):
        return fake_module

    monkeypatch.setattr(
        "app.services.skill_registry.runtimes.backend_task.importlib.import_module",
        _fake_import_module,
    )

    skill = types.SimpleNamespace(
        id="system.assistant_onboarding",
        manifest_json={"entrypoint": "fake.module:run_onboarding"},
    )
    context = RuntimeContext(session_id="s1", user_id="u1")

    strategy = BackendTaskRuntimeStrategy()
    result = await strategy.execute(
        skill=skill,
        inputs={"url": "https://example.com", "__tool_name__": skill.id},
        context=context,
    )

    assert result["status"] == "ok"
    assert captured["apply_async_kwargs"]["url"] == "https://example.com"
    assert captured["apply_async_kwargs"]["user_id"] == "u1"
    assert "__tool_name__" not in captured["apply_async_kwargs"]


@pytest.mark.asyncio
async def test_backend_task_runtime_filters_reserved_kwargs_for_delay_path(monkeypatch):
    captured: dict = {}
    fake_task = _FakeCeleryTask(captured)
    fake_module = types.SimpleNamespace(run_task=fake_task)

    def _fake_import_module(_module_path: str):
        return fake_module

    monkeypatch.setattr(
        "app.services.skill_registry.runtimes.backend_task.importlib.import_module",
        _fake_import_module,
    )

    skill = types.SimpleNamespace(
        id="custom.tool",
        manifest_json={"entrypoint": "fake.module:run_task"},
    )
    context = RuntimeContext(session_id="s1", user_id="u1")

    strategy = BackendTaskRuntimeStrategy()
    result = await strategy.execute(
        skill=skill,
        inputs={
            "payload": 123,
            "wait": False,
            "__tool_name__": "custom.tool",
        },
        context=context,
    )

    assert result["status"] == "ok"
    assert captured["delay_kwargs"]["payload"] == 123
    assert captured["delay_kwargs"]["user_id"] == "u1"
    assert "wait" not in captured["delay_kwargs"]
    assert "__tool_name__" not in captured["delay_kwargs"]


@pytest.mark.asyncio
async def test_backend_task_runtime_onboarding_wait_failure_returns_failed(monkeypatch):
    captured: dict = {}
    fake_task = _FailingCeleryTask(captured)
    fake_module = types.SimpleNamespace(run_onboarding=fake_task)

    def _fake_import_module(_module_path: str):
        return fake_module

    monkeypatch.setattr(
        "app.services.skill_registry.runtimes.backend_task.importlib.import_module",
        _fake_import_module,
    )

    skill = types.SimpleNamespace(
        id="system.assistant_onboarding",
        manifest_json={"entrypoint": "fake.module:run_onboarding"},
    )
    context = RuntimeContext(session_id="s1", user_id="u1")

    strategy = BackendTaskRuntimeStrategy()
    result = await strategy.execute(
        skill=skill,
        inputs={"url": "https://example.com"},
        context=context,
    )

    assert result["status"] == "failed"
    assert result["error_code"] == "SYSTEM_ONBOARDING_TASK_FAILED"
    assert "Onboarding task failed" in result["stdout"][0]
