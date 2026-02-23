from pathlib import Path
from types import SimpleNamespace
import json
import uuid

import pytest
import yaml

import app.agent_plugins.builtins.deeting_core_sdk.plugin as sdk_module
from app.agent_plugins.builtins.deeting_core_sdk.plugin import DeetingCoreSdkPlugin
from app.schemas.tool import ToolDefinition
from app.services.orchestrator.context import Channel, WorkflowContext


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
    assert result["tools"][0]["python_stub"] == "def fetch_web_content(url: str) -> dict: ..."
    assert result["tools"][0]["parameters"][0]["name"] == "url"


@pytest.mark.asyncio
async def test_search_sdk_returns_parameter_docs_and_examples(monkeypatch):
    plugin = _make_plugin()

    async def _fake_build_tools(*, session, user_id, query):
        return [
            ToolDefinition(
                name="search_web",
                description="Search website content",
                input_schema={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "搜索关键词",
                            "example": "Cloudflare MCP",
                        },
                        "top_k": {
                            "type": "integer",
                            "description": "返回条数",
                            "default": 5,
                        },
                        "mode": {
                            "type": "string",
                            "enum": ["fast", "deep"],
                            "description": "检索模式",
                        },
                    },
                    "required": ["query"],
                },
            )
        ]

    monkeypatch.setattr(
        sdk_module.tool_context_service, "build_tools", _fake_build_tools
    )

    result = await plugin.handle_search_sdk("找网页搜索工具", limit=1)
    tool = result["tools"][0]

    assert result["format_version"] == "sdk_toolcard.v2"
    assert tool["signature"] == "search_web(query:string, top_k?:integer=5, mode?:string)"
    assert "def search_web(query: str, top_k: int = 5, mode: str | None = None)" in tool["python_stub"]
    assert tool["required_parameters"] == ["query"]
    assert tool["example_arguments"] == {
        "query": "Cloudflare MCP",
        "top_k": 5,
        "mode": "fast",
    }


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
    assert "import urllib.request" in captured["code"]
    assert "X-Code-Mode-Execution-Token" in captured["code"]
    assert "RUNTIME_CONTEXT = json.loads" in captured["code"]
    assert "RUNTIME_TOOL_RESULTS = json.loads" in captured["code"]
    assert "deeting = DeetingRuntime(context=RUNTIME_CONTEXT, tool_results=RUNTIME_TOOL_RESULTS)" in captured["code"]


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
async def test_execute_code_plan_injects_workflow_runtime_context(monkeypatch):
    plugin = _make_plugin()
    captured = {"code": ""}

    async def _fake_run_code(session_id, code, language, execution_timeout):
        captured["code"] = code
        return {"stdout": ["ok"], "stderr": [], "result": [], "exit_code": 0}

    monkeypatch.setattr(sdk_module.sandbox_manager, "run_code", _fake_run_code)

    wf_ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        user_id=str(plugin.context.user_id),
        tenant_id="tenant-001",
        api_key_id="ak-001",
        requested_model="gpt-4o-mini",
        capability="chat",
        trace_id="trace-001",
        client_ip="127.0.0.1",
    )
    wf_ctx.set("auth", "scopes", ["provider:openai", "preset:default"])
    wf_ctx.set("external_auth", "allowed_models", ["gpt-4o-mini"])
    wf_ctx.set("external_auth", "rate_limit_rpm", 60)
    wf_ctx.set("routing", "provider", "openai")
    wf_ctx.set("routing", "preset_item_id", "pi-001")

    result = await plugin.handle_execute_code_plan(
        code="deeting.log(RUNTIME_CONTEXT.get('permissions'))",
        __context__=wf_ctx,
    )

    assert result["status"] == "success"
    assert '"permissions"' in captured["code"]
    assert '"provider:openai"' in captured["code"]
    assert '"allowed_models": ["gpt-4o-mini"]' in captured["code"]
    assert '"provider": "openai"' in captured["code"]


@pytest.mark.asyncio
async def test_execute_code_plan_injects_runtime_bridge_context(monkeypatch):
    plugin = _make_plugin()
    captured = {"code": "", "claims": None}

    async def _fake_issue_token(*, claims, ttl_seconds):
        captured["claims"] = claims
        return SimpleNamespace(token="bridge-token-123", expires_at="2026-01-01T00:00:00+00:00")

    async def _fake_run_code(session_id, code, language, execution_timeout):
        captured["code"] = code
        return {"stdout": ["ok"], "stderr": [], "result": [], "exit_code": 0}

    monkeypatch.setattr(sdk_module.settings, "CODE_MODE_BRIDGE_ENDPOINT", "http://bridge.local/api/v1/internal/bridge/call")
    monkeypatch.setattr(sdk_module.settings, "CODE_MODE_BRIDGE_TOKEN_TTL_SECONDS", 300)
    monkeypatch.setattr(sdk_module.runtime_bridge_token_service, "issue_token", _fake_issue_token)
    monkeypatch.setattr(sdk_module.sandbox_manager, "run_code", _fake_run_code)

    result = await plugin.handle_execute_code_plan(code="deeting.log('x')")

    assert result["status"] == "success"
    assert captured["claims"] is not None
    assert captured["claims"].user_id == str(plugin.context.user_id)
    assert '"bridge"' in captured["code"]
    assert '"endpoint": "http://bridge.local/api/v1/internal/bridge/call"' in captured["code"]
    assert '"execution_token": "bridge-token-123"' in captured["code"]


@pytest.mark.asyncio
async def test_execute_code_plan_runtime_call_tool_roundtrip(monkeypatch):
    plugin = _make_plugin()
    captured = {"codes": [], "dispatch_calls": []}

    async def _fake_dispatch_real_tool(*, tool_name, arguments, workflow_context):
        captured["dispatch_calls"].append((tool_name, arguments))
        return {"title": "Demo Doc", "url": arguments.get("url")}

    async def _fake_run_code(session_id, code, language, execution_timeout):
        captured["codes"].append(code)
        if len(captured["codes"]) == 1:
            marker = sdk_module._RUNTIME_TOOL_CALL_MARKER + json.dumps(
                {
                    "index": 0,
                    "tool_name": "fetch_web_content",
                    "arguments": {"url": "https://example.com"},
                },
                ensure_ascii=False,
            )
            return {
                "stdout": [marker],
                "stderr": ["runtime interrupted for host tool call"],
                "result": [],
                "exit_code": 1,
            }
        return {"stdout": ["done"], "stderr": [], "result": [], "exit_code": 0}

    monkeypatch.setattr(plugin, "_dispatch_real_tool", _fake_dispatch_real_tool)
    monkeypatch.setattr(sdk_module.sandbox_manager, "run_code", _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code=(
            "page = deeting.call_tool('fetch_web_content', url='https://example.com')\n"
            "deeting.log(page.get('title'))"
        )
    )

    assert result["status"] == "success"
    assert len(captured["codes"]) == 2
    assert len(captured["dispatch_calls"]) == 1
    assert captured["dispatch_calls"][0][0] == "fetch_web_content"
    assert "RUNTIME_TOOL_RESULTS = json.loads" in captured["codes"][0]
    assert "Demo Doc" in captured["codes"][1]
    assert result["runtime"]["runtime_tool_calls"]["count"] == 1
    assert result["runtime"]["runtime_tool_calls"]["calls"][0]["tool_name"] == "fetch_web_content"


@pytest.mark.asyncio
async def test_execute_code_plan_runtime_call_tool_blocks_recursive_tools(monkeypatch):
    plugin = _make_plugin()

    async def _fake_run_code(session_id, code, language, execution_timeout):
        marker = sdk_module._RUNTIME_TOOL_CALL_MARKER + json.dumps(
            {"index": 0, "tool_name": "search_sdk", "arguments": {"query": "x"}},
            ensure_ascii=False,
        )
        return {
            "stdout": [marker],
            "stderr": ["runtime interrupted for host tool call"],
            "result": [],
            "exit_code": 1,
        }

    monkeypatch.setattr(sdk_module.sandbox_manager, "run_code", _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code="deeting.call_tool('search_sdk', query='x')"
    )

    assert result["status"] == "failed"
    assert result["error_code"] == "CODE_MODE_RUNTIME_TOOL_CALL_INVALID"


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
