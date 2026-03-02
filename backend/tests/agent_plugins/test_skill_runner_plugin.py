from __future__ import annotations

import base64
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


@pytest.mark.asyncio
async def test_skill_runner_pushes_ui_blocks_with_sync_context_method(monkeypatch):
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
                        "view_type": "weather.card",
                        "payload": {"city": "天津", "temp": 23},
                    }
                ],
            }

    class _Ctx(SimpleNamespace):
        def push_blocks(self, *blocks):
            self.pushed.extend(blocks)

    monkeypatch.setattr(
        "app.agent_plugins.builtins.skill_runner.plugin.AsyncSessionLocal",
        lambda: _AsyncSessionCtx(object()),
    )
    monkeypatch.setattr(
        "app.services.skill_registry.skill_runtime_executor.SkillRuntimeExecutor",
        _FakeExecutor,
    )

    user_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    plugin = SkillRunnerPlugin()
    plugin._context = SimpleNamespace(session_id="sess", user_id=user_id)
    ctx = _Ctx(
        session_id="sess-ctx",
        user_id=user_id,
        pushed=[],
        get=lambda namespace, key, default=None: default,
    )

    result = await plugin.handle_tool_call("skill__com.deeting.example.weather", __context__=ctx)

    assert result["status"] == "success"
    assert len(ctx.pushed) == 1
    assert ctx.pushed[0]["viewType"] == "weather.card"


@pytest.mark.asyncio
async def test_skill_runner_emits_generated_file_block_for_artifact(monkeypatch):
    class _FakeExecutor:
        def __init__(self, _repo):
            pass

        async def execute(self, **_kwargs):
            return {
                "exit_code": 0,
                "stdout": ["done"],
                "stderr": [],
                "artifacts": [
                    {
                        "name": "report.md",
                        "type": "file",
                        "path": "/workspace/report.md",
                        "size": 24,
                        "content_base64": base64.b64encode(
                            b"# Report\n\nThis is a test."
                        ).decode("utf-8"),
                    }
                ],
            }

    async def _fake_store_asset_bytes(data: bytes, **_kwargs):
        assert data.startswith(b"# Report")
        return SimpleNamespace(
            object_key="skill-artifacts/2026/02/25/report.md",
            content_type="text/markdown",
            size_bytes=len(data),
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
        "app.agent_plugins.builtins.skill_runner.plugin.store_asset_bytes",
        _fake_store_asset_bytes,
    )
    monkeypatch.setattr(
        "app.agent_plugins.builtins.skill_runner.plugin.build_signed_asset_url",
        lambda object_key, **_kwargs: f"https://deeting.example.com/media/{object_key}",
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

    result = await plugin.handle_tool_call("skill__com.example.writer", __context__=ctx)

    assert result["status"] == "success"
    assert result["artifacts"] == ["report.md"]
    ui_blocks = result["ui"]["blocks"]
    assert len(ui_blocks) == 1
    block = ui_blocks[0]
    assert block["view_type"] == "generated.file"
    assert block["payload"]["name"] == "report.md"
    assert block["payload"]["preview_kind"] == "markdown"
    assert block["payload"]["download_url"].startswith("https://deeting.example.com/media/")
    assert "content_base64" not in str(block["payload"])


@pytest.mark.asyncio
async def test_skill_runner_skips_invalid_artifact_base64(monkeypatch):
    class _FakeExecutor:
        def __init__(self, _repo):
            pass

        async def execute(self, **_kwargs):
            return {
                "exit_code": 0,
                "stdout": ["done"],
                "stderr": [],
                "artifacts": [
                    {
                        "name": "broken.txt",
                        "type": "file",
                        "path": "/workspace/broken.txt",
                        "size": 10,
                        "content_base64": "not-valid-base64!!!",
                    }
                ],
            }

    monkeypatch.setattr(
        "app.agent_plugins.builtins.skill_runner.plugin.AsyncSessionLocal",
        lambda: _AsyncSessionCtx(object()),
    )
    monkeypatch.setattr(
        "app.services.skill_registry.skill_runtime_executor.SkillRuntimeExecutor",
        _FakeExecutor,
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

    result = await plugin.handle_tool_call("skill__com.example.writer", __context__=ctx)

    assert result["status"] == "success"
    assert result["artifacts"] == ["broken.txt"]
    assert "ui" not in result


@pytest.mark.asyncio
async def test_skill_runner_returns_error_when_runtime_failed(monkeypatch):
    class _FakeExecutor:
        def __init__(self, _repo):
            pass

        async def execute(self, **_kwargs):
            return {
                "exit_code": 1,
                "stdout": ["failed in worker"],
                "stderr": [],
                "error": "assistant onboarding failed",
                "error_code": "SYSTEM_ONBOARDING_TASK_FAILED",
                "artifacts": [],
            }

    monkeypatch.setattr(
        "app.agent_plugins.builtins.skill_runner.plugin.AsyncSessionLocal",
        lambda: _AsyncSessionCtx(object()),
    )
    monkeypatch.setattr(
        "app.services.skill_registry.skill_runtime_executor.SkillRuntimeExecutor",
        _FakeExecutor,
    )

    user_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    plugin = SkillRunnerPlugin()
    plugin._context = SimpleNamespace(session_id="sess", user_id=user_id)
    ctx = SimpleNamespace(
        session_id="sess-ctx",
        user_id=user_id,
        get=lambda namespace, key, default=None: default,
    )

    result = await plugin.handle_tool_call(
        "skill__system.assistant_onboarding", __context__=ctx, url="https://example.com"
    )

    assert result["status"] == "failed"
    assert result["error"] == "assistant onboarding failed"
    assert result["error_code"] == "SYSTEM_ONBOARDING_TASK_FAILED"
