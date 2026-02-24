from __future__ import annotations

from types import SimpleNamespace
import uuid

import pytest

from app.agent_plugins.builtins.skill_runner.plugin import SkillRunnerPlugin


class _AsyncSessionCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_skill_runner_injects_plugin_iframe_renderer_url(monkeypatch):
    captured: dict[str, object] = {}

    class _FakeExecutor:
        def __init__(self, _repo):
            pass

        async def execute(self, **kwargs):
            captured["execute_kwargs"] = kwargs
            return {
                "exit_code": 0,
                "stdout": ["ok"],
                "stderr": [],
                "artifacts": [],
                "render_blocks": [
                    {
                        "type": "ui",
                        "view_type": "stock.trend",
                        "payload": {"symbol": "AAPL"},
                        "metadata": {"theme": "light"},
                    }
                ],
            }

    class _FakeUiGatewayService:
        def __init__(self, _session):
            pass

        async def issue_renderer_session(self, **kwargs):
            captured["ui_kwargs"] = kwargs
            return SimpleNamespace(
                renderer_url="https://deeting.example.com/api/v1/plugin-market/ui/t/token/index.html"
            )

    monkeypatch.setattr(
        "app.agent_plugins.builtins.skill_runner.plugin.AsyncSessionLocal",
        lambda: _AsyncSessionCtx(object()),
    )
    monkeypatch.setattr(
        "app.services.skill_registry.skill_runtime_executor.SkillRuntimeExecutor",
        _FakeExecutor,
    )
    monkeypatch.setattr(
        "app.agent_plugins.builtins.skill_runner.plugin.PluginUiGatewayService",
        _FakeUiGatewayService,
    )

    user_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    plugin = SkillRunnerPlugin()
    plugin._context = SimpleNamespace(session_id="sess-fallback", user_id=user_id)
    ctx = SimpleNamespace(
        session_id="sess-ctx",
        user_id=user_id,
        get=lambda namespace, key, default=None: (
            "https://deeting.example.com"
            if namespace == "request" and key == "base_url"
            else default
        ),
    )

    result = await plugin.handle_tool_call("skill__com.example.stock", __context__=ctx, symbol="AAPL")

    assert result["status"] == "success"
    assert result["ui"]["blocks"][0]["view_type"] == "plugin.iframe"
    assert result["ui"]["blocks"][0]["metadata"]["renderer_url"].startswith(
        "https://deeting.example.com/api/v1/plugin-market/ui/t/"
    )
    assert result["ui"]["blocks"][0]["metadata"]["plugin_view_type"] == "stock.trend"
    assert result["ui"]["blocks"][0]["metadata"]["skill_id"] == "com.example.stock"
    assert captured["execute_kwargs"]["inputs"]["__tool_name__"] == "com.example.stock"
    assert captured["ui_kwargs"]["base_url"] == "https://deeting.example.com"


@pytest.mark.asyncio
async def test_skill_runner_fallbacks_to_original_view_type_when_ui_session_fails(monkeypatch):
    class _FakeExecutor:
        def __init__(self, _repo):
            pass

        async def execute(self, **_kwargs):
            return {
                "exit_code": 0,
                "stdout": ["ok"],
                "stderr": [],
                "artifacts": [],
                "render_blocks": [
                    {
                        "type": "ui",
                        "view_type": "table.simple",
                        "payload": {"rows": [1]},
                    }
                ],
            }

    class _FailUiGatewayService:
        def __init__(self, _session):
            pass

        async def issue_renderer_session(self, **_kwargs):
            raise RuntimeError("boom")

    monkeypatch.setattr(
        "app.agent_plugins.builtins.skill_runner.plugin.AsyncSessionLocal",
        lambda: _AsyncSessionCtx(object()),
    )
    monkeypatch.setattr(
        "app.services.skill_registry.skill_runtime_executor.SkillRuntimeExecutor",
        _FakeExecutor,
    )
    monkeypatch.setattr(
        "app.agent_plugins.builtins.skill_runner.plugin.PluginUiGatewayService",
        _FailUiGatewayService,
    )

    user_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    plugin = SkillRunnerPlugin()
    plugin._context = SimpleNamespace(session_id="sess", user_id=user_id)
    ctx = SimpleNamespace(
        session_id="sess-ctx",
        user_id=user_id,
        get=lambda namespace, key, default=None: (
            "https://deeting.example.com"
            if namespace == "request" and key == "base_url"
            else default
        ),
    )

    result = await plugin.handle_tool_call("skill__com.example.stock", __context__=ctx)

    block = result["ui"]["blocks"][0]
    assert block["view_type"] == "table.simple"
    assert "renderer_url" not in block["metadata"]
    assert block["metadata"]["plugin_view_type"] == "table.simple"
