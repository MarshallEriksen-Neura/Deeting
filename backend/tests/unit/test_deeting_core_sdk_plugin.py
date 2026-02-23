from pathlib import Path
from types import SimpleNamespace
import uuid

import pytest
import yaml

import app.agent_plugins.builtins.deeting_core_sdk.plugin as sdk_module
from app.agent_plugins.builtins.deeting_core_sdk.plugin import DeetingCoreSdkPlugin
from app.schemas.tool import ToolDefinition


class _AsyncSessionCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _make_plugin() -> DeetingCoreSdkPlugin:
    plugin = DeetingCoreSdkPlugin()
    plugin._context = SimpleNamespace(
        user_id=uuid.uuid4(),
        session_id="sess-1",
        get_db_session=lambda: _AsyncSessionCtx(None),
    )
    return plugin


@pytest.mark.asyncio
async def test_search_sdk_returns_typed_signatures(monkeypatch):
    plugin = _make_plugin()

    async def _fake_build_tools(*, session, user_id, query):
        assert query == "查找网页抓取工具"
        assert user_id == plugin.context.user_id
        return [
            ToolDefinition(
                name="fetch_web_content",
                description="Fetch one web page",
                input_schema={
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                },
            ),
            ToolDefinition(
                name="search_sdk",
                description="internal",
                input_schema={"type": "object", "properties": {}},
            ),
        ]

    monkeypatch.setattr(
        sdk_module.tool_context_service, "build_tools", _fake_build_tools
    )

    result = await plugin.handle_search_sdk("查找网页抓取工具", limit=1)

    assert result["count"] == 1
    assert result["tools"][0]["name"] == "fetch_web_content"
    assert result["tools"][0]["signature"] == "fetch_web_content(url:string)"


@pytest.mark.asyncio
async def test_execute_code_plan_blocks_forbidden_import():
    plugin = _make_plugin()

    result = await plugin.handle_execute_code_plan("import subprocess\nprint('x')")

    assert result["error_code"] == "CODE_MODE_VALIDATION_FAILED"
    assert "forbidden import: subprocess" in result["violations"]


@pytest.mark.asyncio
async def test_execute_code_plan_executes_in_sandbox(monkeypatch):
    plugin = _make_plugin()
    captured: dict[str, str] = {}

    async def _fake_run_code(session_id, code, language, execution_timeout):
        captured["session_id"] = session_id
        captured["code"] = code
        captured["language"] = language
        captured["execution_timeout"] = str(execution_timeout)
        return {
            "stdout": ["hello"],
            "stderr": [],
            "result": [],
            "exit_code": 0,
        }

    monkeypatch.setattr(sdk_module.sandbox_manager, "run_code", _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code="deeting.log('ok')", execution_timeout=15
    )

    assert result["status"] == "success"
    assert result["stdout"] == "hello"
    assert "runtime" in result
    assert result["runtime"]["session_id"] == "sess-1"
    assert captured["session_id"] == "sess-1"
    assert captured["language"] == "python"
    assert captured["execution_timeout"] == "15"
    assert "class DeetingRuntime" in captured["code"]


@pytest.mark.asyncio
async def test_execute_code_plan_dry_run_does_not_call_sandbox(monkeypatch):
    plugin = _make_plugin()
    called = {"value": False}

    async def _fake_run_code(*_args, **_kwargs):
        called["value"] = True
        return {"exit_code": 0}

    monkeypatch.setattr(sdk_module.sandbox_manager, "run_code", _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code="deeting.log('validate')",
        dry_run=True,
    )

    assert result["status"] == "dry_run"
    assert result["validation"]["ok"] is True
    assert "runtime" in result
    assert called["value"] is False


@pytest.mark.asyncio
async def test_execute_code_plan_runs_tool_plan_and_injects_results(monkeypatch):
    plugin = _make_plugin()
    captured = {"code": "", "called_args": []}

    async def _fake_dispatch_real_tool(*, tool_name, arguments, workflow_context):
        captured["called_args"].append((tool_name, arguments))
        if tool_name == "fetch_web_content":
            return {"title": "Doc", "url": arguments.get("url")}
        if tool_name == "summarize_page":
            return {"summary": f"summary:{arguments.get('title')}"}
        return {"ok": True}

    async def _fake_run_code(session_id, code, language, execution_timeout):
        captured["code"] = code
        return {"stdout": ["ok"], "stderr": [], "result": [], "exit_code": 0}

    monkeypatch.setattr(plugin, "_dispatch_real_tool", _fake_dispatch_real_tool)
    monkeypatch.setattr(sdk_module.sandbox_manager, "run_code", _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code="deeting.log(TOOL_PLAN_RESULTS)",
        tool_plan=[
            {
                "step_id": "crawl",
                "tool_name": "fetch_web_content",
                "arguments": {"url": "https://example.com"},
                "save_as": "page",
            },
            {
                "step_id": "sum",
                "tool_name": "summarize_page",
                "arguments": {"title": {"$ref": "page.title"}},
            },
        ],
    )

    assert result["status"] == "success"
    assert result["runtime"]["tool_plan"]["success"] is True
    assert captured["called_args"][1][1]["title"] == "Doc"
    assert "TOOL_PLAN_RESULTS = json.loads" in captured["code"]
    assert '"page"' in captured["code"]


@pytest.mark.asyncio
async def test_execute_code_plan_tool_plan_failure_stops_and_skips_sandbox(monkeypatch):
    plugin = _make_plugin()
    called = {"sandbox": False}

    async def _fake_dispatch_real_tool(*, tool_name, arguments, workflow_context):
        return {"error": "tool unavailable"}

    async def _fake_run_code(*_args, **_kwargs):
        called["sandbox"] = True
        return {"exit_code": 0}

    monkeypatch.setattr(plugin, "_dispatch_real_tool", _fake_dispatch_real_tool)
    monkeypatch.setattr(sdk_module.sandbox_manager, "run_code", _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code="print('x')",
        tool_plan=[{"tool_name": "fetch_web_content", "arguments": {}}],
    )

    assert result["status"] == "failed"
    assert result["error_code"] == "CODE_MODE_TOOL_PLAN_FAILED"
    assert called["sandbox"] is False


@pytest.mark.asyncio
async def test_execute_code_plan_tool_plan_validation_rejects_recursive_tools():
    plugin = _make_plugin()

    result = await plugin.handle_execute_code_plan(
        code="print('x')",
        tool_plan=[{"tool_name": "search_sdk", "arguments": {}}],
    )

    assert result["status"] == "failed"
    assert result["error_code"] == "CODE_MODE_TOOL_PLAN_INVALID"
    assert "not allowed" in result["violations"][0]


def test_plugins_yaml_registers_deeting_core_sdk_plugin():
    plugins_yaml = (
        Path(__file__).resolve().parents[2] / "app" / "core" / "plugins.yaml"
    )
    content = yaml.safe_load(plugins_yaml.read_text(encoding="utf-8"))

    plugin = next(
        (
            p
            for p in content.get("plugins", [])
            if p.get("id") == "system.deeting_core_sdk"
        ),
        None,
    )
    assert plugin is not None
    assert plugin.get("module") == "app.agent_plugins.builtins.deeting_core_sdk.plugin"
    assert plugin.get("class_name") == "DeetingCoreSdkPlugin"
    assert set(plugin.get("tools", [])) == {"search_sdk", "execute_code_plan"}
