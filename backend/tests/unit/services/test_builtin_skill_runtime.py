import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.code_mode import protocol as code_mode_protocol
from app.services.skill_registry.runtimes.base import RuntimeContext
from app.services.skill_registry.runtimes.builtin import BuiltinSkillRuntimeStrategy


class _FakeProcess:
    def __init__(self) -> None:
        self.returncode = 0

    async def communicate(self, input=None):
        _ = input
        return json.dumps({"ok": True}).encode("utf-8"), b""


class _MarkerProcess:
    def __init__(self, tool_name: str) -> None:
        self.returncode = 1
        self._tool_name = tool_name

    async def communicate(self, input=None):
        _ = input
        marker = code_mode_protocol.RUNTIME_TOOL_CALL_MARKER + json.dumps(
            {"tool_name": self._tool_name, "arguments": {"url": "https://example.com"}}
        )
        return marker.encode("utf-8"), b""


@pytest.mark.asyncio
async def test_builtin_runtime_resolves_workspace_packages(monkeypatch):
    strategy = BuiltinSkillRuntimeStrategy()
    captured: dict[str, object] = {}

    async def _fake_create_subprocess_exec(*args, **kwargs):
        captured["args"] = args
        captured["cwd"] = kwargs.get("cwd")
        return _FakeProcess()

    monkeypatch.setattr(
        "app.services.skill_registry.runtimes.builtin.asyncio.create_subprocess_exec",
        _fake_create_subprocess_exec,
    )

    skill = SimpleNamespace(id="official.skills.crawler", manifest_json={})
    context = RuntimeContext(
        session_id="sess-1",
        user_id="user-1",
        intent="fetch_web_content",
    )
    result = await strategy.execute(
        skill=skill,
        inputs={"url": "https://example.com", "__tool_name__": "fetch_web_content"},
        context=context,
    )

    expected_main = Path("/data/Deeting/packages/official-skills/crawler/main.py")
    assert captured["args"][1] == str(expected_main)
    assert captured["cwd"] == str(expected_main.parent)
    assert result["status"] == "ok"


@pytest.mark.asyncio
async def test_builtin_runtime_rejects_marker_host_tool_execution(monkeypatch):
    strategy = BuiltinSkillRuntimeStrategy()
    execute_inner = AsyncMock()
    monkeypatch.setattr(strategy, "_execute_inner_tool_call", execute_inner, raising=False)

    async def _fake_create_subprocess_exec(*args, **kwargs):
        _ = args, kwargs
        return _MarkerProcess("fetch_web_content")

    monkeypatch.setattr(
        "app.services.skill_registry.runtimes.builtin.asyncio.create_subprocess_exec",
        _fake_create_subprocess_exec,
    )

    skill = SimpleNamespace(id="official.skills.crawler", manifest_json={})
    context = RuntimeContext(
        session_id="sess-1",
        user_id="user-1",
        intent="fetch_web_content",
    )

    result = await strategy.execute(
        skill=skill,
        inputs={"url": "https://example.com", "__tool_name__": "fetch_web_content"},
        context=context,
    )

    assert result["status"] == "error"
    assert "marker-based host tool execution is disabled in cloud runtime" in result["error"]
    assert "fetch_web_content" in result["error"]
    execute_inner.assert_not_called()
