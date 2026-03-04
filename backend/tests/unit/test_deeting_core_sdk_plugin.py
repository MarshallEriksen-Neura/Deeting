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


def _patch_run_code_stream(monkeypatch, fake_run_code):
    async def _fake_run_code_stream(
        session_id,
        code,
        language,
        execution_timeout,
    ):
        result = await fake_run_code(
            session_id=session_id,
            code=code,
            language=language,
            execution_timeout=execution_timeout,
        )
        for chunk in result.get("stdout", []) or []:
            yield {"type": "stdout", "content": chunk}
        for chunk in result.get("stderr", []) or []:
            yield {"type": "stderr", "content": chunk}
        yield {
            "type": "exit",
            "exit_code": result.get("exit_code", 0),
            "result": result.get("result", []),
        }

    monkeypatch.setattr(
        sdk_module.sandbox_manager,
        "run_code_stream",
        _fake_run_code_stream,
    )


def _make_plugin() -> DeetingCoreSdkPlugin:
    plugin = DeetingCoreSdkPlugin()
    plugin._context = SimpleNamespace(
        user_id=uuid.uuid4(),
        session_id="sess-1",
        get_db_session=lambda: _AsyncSessionCtx(None),
    )
    return plugin


@pytest.mark.asyncio
async def test_dispatch_local_tool_returns_none_for_non_system_tool():
    plugin = _make_plugin()
    result = await plugin._dispatch_local_tool(
        "fetch_web_content",
        {"url": "https://example.com"},
        workflow_context=None,
    )
    assert result is None


@pytest.mark.asyncio
async def test_search_sdk_returns_typed_signatures(monkeypatch):
    plugin = _make_plugin()
    captured: dict[str, bool] = {"include_non_core_in_code_mode": False}

    async def _fake_build_tools(
        *, session, user_id, query, include_non_core_in_code_mode=False
    ):
        assert query == "查找网页抓取工具"
        assert user_id == plugin.context.user_id
        captured["include_non_core_in_code_mode"] = bool(include_non_core_in_code_mode)
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
    assert captured["include_non_core_in_code_mode"] is True
    assert result["tools"][0]["name"] == "fetch_web_content"
    assert (
        result["tools"][0]["signature"]
        == "fetch_web_content(url:string) -> dict[str, Any]"
    )
    assert "def fetch_web_content(url: str) -> dict[str, Any]:" in result["tools"][0][
        "python_stub"
    ]
    assert result["tools"][0]["parameters"][0]["name"] == "url"


@pytest.mark.asyncio
async def test_search_sdk_returns_parameter_docs_and_examples(monkeypatch):
    plugin = _make_plugin()

    async def _fake_build_tools(
        *, session, user_id, query, include_non_core_in_code_mode=False
    ):
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
    assert (
        tool["signature"]
        == "search_web(query:string, top_k?:integer=5, mode?:string) -> dict[str, Any]"
    )
    assert "def search_web(query: str, top_k: int = 5, mode: str | None = None)" in tool["python_stub"]
    assert tool["required_parameters"] == ["query"]
    assert tool["example_arguments"] == {
        "query": "Cloudflare MCP",
        "top_k": 5,
        "mode": "fast",
    }


@pytest.mark.asyncio
async def test_search_sdk_usage_hint_includes_code_mode_conventions(monkeypatch):
    plugin = _make_plugin()

    async def _fake_build_tools(
        *, session, user_id, query, include_non_core_in_code_mode=False
    ):
        return [
            ToolDefinition(
                name="tavily-search",
                description="search web",
                input_schema={
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            )
        ]

    monkeypatch.setattr(
        sdk_module.tool_context_service, "build_tools", _fake_build_tools
    )

    result = await plugin.handle_search_sdk("搜索本周趋势")

    usage_hint = str(result.get("usage_hint") or "")
    assert "deeting.call_tool(name, **kwargs)" in usage_hint
    assert "deeting.call_tool(name, { ... })" in usage_hint
    assert "deeting.log(json.dumps(result, ensure_ascii=False))" in usage_hint


@pytest.mark.asyncio
async def test_search_sdk_records_snapshot_into_workflow_context(monkeypatch):
    plugin = _make_plugin()

    async def _fake_build_tools(
        *, session, user_id, query, include_non_core_in_code_mode=False
    ):
        return [
            ToolDefinition(
                name="fetch_web_content",
                description="Fetch one web page",
                input_schema={
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                },
            )
        ]

    monkeypatch.setattr(
        sdk_module.tool_context_service, "build_tools", _fake_build_tools
    )

    wf_ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        user_id=str(plugin.context.user_id),
        session_id="sess-1",
    )
    result = await plugin.handle_search_sdk(
        "查找网页抓取工具",
        limit=1,
        __context__=wf_ctx,
    )

    snapshot = wf_ctx.get("code_mode", "search_sdk_snapshot")
    assert result["count"] == 1
    assert isinstance(snapshot, dict)
    assert snapshot["tool_count"] == 1
    assert snapshot["tool_names"] == ["fetch_web_content"]


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

    _patch_run_code_stream(monkeypatch, _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code="deeting.log('ok')", execution_timeout=15
    )

    assert result["status"] == "success"
    assert result["format_version"] == sdk_module._EXECUTION_FORMAT_VERSION
    assert result["runtime_protocol_version"] == sdk_module._RUNTIME_PROTOCOL_VERSION
    assert result["stdout"] == "hello"
    assert "runtime" in result
    assert result["runtime"]["session_id"] == "sess-1"
    assert result["runtime"]["user_id"] == str(plugin.context.user_id)
    assert result["runtime"]["runtime_protocol_version"] == sdk_module._RUNTIME_PROTOCOL_VERSION
    assert "started_at" in result["runtime"]
    assert isinstance(result["runtime"]["duration_ms"], int)
    assert captured["session_id"] == "sess-1"
    assert captured["language"] == "python"
    assert captured["execution_timeout"] == "15"
    assert "class DeetingRuntime" in captured["code"]
    assert "def call_tool(self, tool_name, *args, **arguments)" in captured["code"]
    assert "import urllib.request" in captured["code"]
    assert "X-Code-Mode-Execution-Token" in captured["code"]
    assert "RUNTIME_CONTEXT = json.loads" in captured["code"]
    assert "RUNTIME_TOOL_RESULTS = json.loads" in captured["code"]
    assert "deeting = DeetingRuntime(context=RUNTIME_CONTEXT, tool_results=RUNTIME_TOOL_RESULTS)" in captured["code"]


@pytest.mark.asyncio
async def test_execute_code_plan_calls_persist_execution_record(monkeypatch):
    plugin = _make_plugin()
    captured = {"persisted": False}

    async def _fake_run_code(session_id, code, language, execution_timeout):
        return {
            "stdout": ["ok"],
            "stderr": [],
            "result": [],
            "exit_code": 0,
        }

    async def _fake_persist(**kwargs):
        captured["persisted"] = True
        captured["status"] = kwargs["response"]["status"]
        captured["language"] = kwargs["language"]

    _patch_run_code_stream(monkeypatch, _fake_run_code)
    monkeypatch.setattr(plugin, "_persist_execution_record", _fake_persist)

    result = await plugin.handle_execute_code_plan(code="print('ok')")

    assert result["status"] == "success"
    assert captured["persisted"] is True
    assert captured["status"] == "success"
    assert captured["language"] == "python"


@pytest.mark.asyncio
async def test_execute_code_plan_logs_source_preview(monkeypatch):
    plugin = _make_plugin()
    info_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    async def _fake_run_code(session_id, code, language, execution_timeout):
        return {
            "stdout": ["ok"],
            "stderr": [],
            "result": [],
            "exit_code": 0,
        }

    def _capture_info(*args, **kwargs):
        info_calls.append((args, kwargs))

    _patch_run_code_stream(monkeypatch, _fake_run_code)
    monkeypatch.setattr(sdk_module.logger, "info", _capture_info)

    result = await plugin.handle_execute_code_plan(code="x = 1\nprint(x)")

    assert result["status"] == "success"
    source_logs = [
        call
        for call in info_calls
        if call[0] and isinstance(call[0][0], str) and call[0][0] == "code_mode_source"
    ]
    assert len(source_logs) == 1
    source_extra = source_logs[0][1].get("extra")
    assert isinstance(source_extra, dict)
    assert source_extra["code_preview"] == "x = 1\nprint(x)"
    assert source_extra["code_preview_truncated"] is False
    assert source_extra["code_chars"] == len("x = 1\nprint(x)")


@pytest.mark.asyncio
async def test_execute_code_plan_logs_empty_result_diagnostic(monkeypatch):
    plugin = _make_plugin()
    info_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    async def _fake_run_code(session_id, code, language, execution_timeout):
        return {
            "stdout": ["log line"],
            "stderr": [],
            "result": [],
            "exit_code": 0,
        }

    def _capture_info(*args, **kwargs):
        info_calls.append((args, kwargs))

    _patch_run_code_stream(monkeypatch, _fake_run_code)
    monkeypatch.setattr(sdk_module.logger, "info", _capture_info)

    result = await plugin.handle_execute_code_plan(code="print('log line')")

    assert result["status"] == "success"
    empty_result_logs = [
        call
        for call in info_calls
        if call[0]
        and isinstance(call[0][0], str)
        and call[0][0] == "code_mode_empty_result"
    ]
    assert len(empty_result_logs) == 1
    empty_extra = empty_result_logs[0][1].get("extra")
    assert isinstance(empty_extra, dict)
    assert empty_extra["result_chars"] == 0
    assert empty_extra["stdout_chars"] > 0
    assert empty_extra["stderr_chars"] == 0


@pytest.mark.asyncio
async def test_execute_code_plan_recovers_result_from_stdout_json(monkeypatch):
    plugin = _make_plugin()
    info_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    async def _fake_run_code(session_id, code, language, execution_timeout):
        return {
            "stdout": [
                '[deeting.log] {"status":"ok","items":[{"name":"repo-a","stars":123}]}'
            ],
            "stderr": [],
            "result": [],
            "exit_code": 0,
        }

    def _capture_info(*args, **kwargs):
        info_calls.append((args, kwargs))

    _patch_run_code_stream(monkeypatch, _fake_run_code)
    monkeypatch.setattr(sdk_module.logger, "info", _capture_info)

    result = await plugin.handle_execute_code_plan(code="deeting.log('done')")

    assert result["status"] == "success"
    assert json.loads(result["result"]) == {
        "status": "ok",
        "items": [{"name": "repo-a", "stars": 123}],
    }
    recovered_logs = [
        call
        for call in info_calls
        if call[0]
        and isinstance(call[0][0], str)
        and call[0][0] == "code_mode_result_recovered"
    ]
    assert len(recovered_logs) == 1
    empty_logs = [
        call
        for call in info_calls
        if call[0]
        and isinstance(call[0][0], str)
        and call[0][0] == "code_mode_empty_result"
    ]
    assert len(empty_logs) == 0


@pytest.mark.asyncio
async def test_execute_code_plan_recovers_result_from_stdout_python_literal(monkeypatch):
    plugin = _make_plugin()

    async def _fake_run_code(session_id, code, language, execution_timeout):
        return {
            "stdout": ["[deeting.log] {'status': 'ok', 'count': 2}"],
            "stderr": [],
            "result": [],
            "exit_code": 0,
        }

    _patch_run_code_stream(monkeypatch, _fake_run_code)

    result = await plugin.handle_execute_code_plan(code="deeting.log({'status': 'ok'})")

    assert result["status"] == "success"
    assert json.loads(result["result"]) == {"status": "ok", "count": 2}


@pytest.mark.asyncio
async def test_execute_code_plan_injects_runtime_sdk_stub(monkeypatch):
    plugin = _make_plugin()
    captured: dict[str, str] = {}

    async def _fake_build_tool_candidates(*, user_id, query):
        assert user_id == plugin.context.user_id
        assert query
        return [
            ToolDefinition(
                name="fetch_web_content",
                description="Fetch web content",
                input_schema={
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                },
            )
        ]

    async def _fake_run_code(session_id, code, language, execution_timeout):
        captured["code"] = code
        return {
            "stdout": ["ok"],
            "stderr": [],
            "result": [],
            "exit_code": 0,
        }

    monkeypatch.setattr(plugin, "_build_tool_candidates", _fake_build_tool_candidates)
    _patch_run_code_stream(monkeypatch, _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code="from deeting_sdk import fetch_web_content\nprint('ok')"
    )

    assert result["status"] == "success"
    assert result["runtime"]["sdk_stub"]["module"] == "deeting_sdk"
    assert result["runtime"]["sdk_stub"]["tool_count"] == 1
    assert "DEETING_SDK_PYI = json.loads" in captured["code"]
    assert "DEETING_SDK_PY = json.loads" in captured["code"]
    assert "deeting_runtime_sdk" in captured["code"]
    assert "builtins.__DEETING_RUNTIME__ = deeting" in captured["code"]
    assert "def fetch_web_content(url: str) -> dict[str, Any]:" in captured["code"]


@pytest.mark.asyncio
async def test_execute_code_plan_dry_run_does_not_call_sandbox(monkeypatch):
    plugin = _make_plugin()
    called = {"value": False}

    async def _fake_run_code(*_args, **_kwargs):
        called["value"] = True
        return {"exit_code": 0}

    _patch_run_code_stream(monkeypatch, _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code="deeting.log('validate')",
        dry_run=True,
    )

    assert result["status"] == "dry_run"
    assert result["format_version"] == sdk_module._EXECUTION_FORMAT_VERSION
    assert result["runtime_protocol_version"] == sdk_module._RUNTIME_PROTOCOL_VERSION
    assert result["validation"]["ok"] is True
    assert "runtime" in result
    assert isinstance(result["runtime"]["duration_ms"], int)
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
    _patch_run_code_stream(monkeypatch, _fake_run_code)

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

    _patch_run_code_stream(monkeypatch, _fake_run_code)

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
    assert "'permissions'" in captured["code"]
    assert "RUNTIME_CONTEXT = json.loads" in captured["code"]


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
    _patch_run_code_stream(monkeypatch, _fake_run_code)

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
    _patch_run_code_stream(monkeypatch, _fake_run_code)

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
    trace_call = result["runtime"]["runtime_tool_calls"]["calls"][0]
    trace_tool_name = trace_call.get("tool_name") or trace_call.get("name")
    assert trace_tool_name == "fetch_web_content"
    if "status" in trace_call:
        assert trace_call["status"] == "success"
    if "duration_ms" in trace_call:
        assert isinstance(trace_call["duration_ms"], int)
        assert trace_call["duration_ms"] >= 0


@pytest.mark.asyncio
async def test_execute_code_plan_bridge_fallback_marker_dispatches_tool(monkeypatch):
    plugin = _make_plugin()
    captured = {"codes": [], "dispatch_calls": []}

    async def _fake_issue_runtime_bridge_context(
        *,
        workflow_context,
        runtime_meta,
        final_session_id,
    ):
        return {
            "endpoint": "http://bridge.local/api/v1/internal/bridge/call",
            "execution_token": "bridge-token-xyz",
            "timeout_seconds": 2,
            "mode": "http_with_marker_fallback",
        }

    async def _fake_store_context(_token, _context):
        return None

    async def _fake_dispatch_real_tool(*, tool_name, arguments, workflow_context):
        captured["dispatch_calls"].append((tool_name, arguments))
        return {"title": "Demo Doc", "url": arguments.get("url")}

    async def _fake_run_code_stream(session_id, code, language, execution_timeout):
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
            yield {"type": "stdout", "content": marker}
            yield {"type": "stderr", "content": "runtime interrupted for host tool call"}
            yield {"type": "exit", "exit_code": 1, "result": []}
            return

        yield {"type": "stdout", "content": "[deeting.log] Demo Doc"}
        yield {"type": "exit", "exit_code": 0, "result": []}

    monkeypatch.setattr(
        plugin,
        "_issue_runtime_bridge_context",
        _fake_issue_runtime_bridge_context,
    )
    monkeypatch.setattr(
        sdk_module.runtime_bridge_token_service,
        "store_context",
        _fake_store_context,
    )
    monkeypatch.setattr(plugin, "_dispatch_real_tool", _fake_dispatch_real_tool)
    monkeypatch.setattr(
        sdk_module.sandbox_manager,
        "run_code_stream",
        _fake_run_code_stream,
    )

    result = await plugin.handle_execute_code_plan(
        code=(
            "page = deeting.call_tool('fetch_web_content', url='https://example.com')\n"
            "deeting.log(page.get('title'))"
        )
    )

    assert result["status"] == "success"
    assert "Demo Doc" in result["stdout"]
    assert len(captured["codes"]) == 2
    assert len(captured["dispatch_calls"]) == 1
    assert captured["dispatch_calls"][0][0] == "fetch_web_content"
    assert "Demo Doc" in captured["codes"][1]
    assert result["runtime"]["runtime_tool_calls"]["count"] == 1
    bridge_meta = result["runtime"].get("bridge")
    if isinstance(bridge_meta, dict):
        assert bridge_meta.get("fallback_to_marker") is True
        assert bridge_meta.get("fallback_attempt") == 1


@pytest.mark.asyncio
async def test_execute_code_plan_runtime_call_tool_trace_contains_error_details(monkeypatch):
    plugin = _make_plugin()

    async def _fake_dispatch_real_tool(*, tool_name, arguments, workflow_context):
        return {
            "error": f"{tool_name} failed for {arguments.get('url')}",
            "error_code": "UPSTREAM_TIMEOUT",
        }

    async def _fake_run_code(session_id, code, language, execution_timeout):
        marker = sdk_module._RUNTIME_TOOL_CALL_MARKER + json.dumps(
            {
                "index": 0,
                "tool_name": "fetch_web_content",
                "arguments": {"url": "https://example.com"},
            },
            ensure_ascii=False,
        )
        if "RUNTIME_TOOL_RESULTS = json.loads('[]')" in code:
            return {
                "stdout": [marker],
                "stderr": ["runtime interrupted for host tool call"],
                "result": [],
                "exit_code": 1,
            }
        return {"stdout": ["done"], "stderr": [], "result": [], "exit_code": 0}

    monkeypatch.setattr(plugin, "_dispatch_real_tool", _fake_dispatch_real_tool)
    _patch_run_code_stream(monkeypatch, _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code=(
            "resp = deeting.call_tool('fetch_web_content', url='https://example.com')\n"
            "deeting.log(resp)"
        )
    )

    assert result["status"] == "success"
    trace_call = result["runtime"]["runtime_tool_calls"]["calls"][0]
    trace_tool_name = trace_call.get("tool_name") or trace_call.get("name")
    assert trace_tool_name == "fetch_web_content"
    if "status" in trace_call:
        assert trace_call["status"] == "failed"
    if "error_code" in trace_call:
        assert trace_call["error_code"] == "UPSTREAM_TIMEOUT"
    if "error" in trace_call:
        assert "fetch_web_content failed" in trace_call["error"]
    if "duration_ms" in trace_call:
        assert isinstance(trace_call["duration_ms"], int)


@pytest.mark.asyncio
async def test_execute_code_plan_collects_runtime_render_blocks(monkeypatch):
    plugin = _make_plugin()

    async def _fake_run_code(session_id, code, language, execution_timeout):
        marker = sdk_module._RUNTIME_RENDER_BLOCK_MARKER + json.dumps(
            {
                "view_type": "table.simple",
                "title": "Top Items",
                "payload": {"rows": [{"name": "alpha", "score": 98}]},
            },
            ensure_ascii=False,
        )
        return {
            "stdout": [marker, "done"],
            "stderr": [],
            "result": [],
            "exit_code": 0,
        }

    _patch_run_code_stream(monkeypatch, _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code=(
            "deeting.render('table.simple', payload={'rows':[{'name':'alpha','score':98}]}, "
            "title='Top Items')\n"
            "print('done')"
        )
    )

    assert result["status"] == "success"
    assert result["stdout"] == "done"
    assert "ui" in result
    assert result["ui"]["blocks"][0]["type"] == "ui"
    assert result["ui"]["blocks"][0]["viewType"] == "table.simple"
    assert result["ui"]["blocks"][0]["title"] == "Top Items"
    assert result["runtime"]["render_blocks"]["count"] == 1


@pytest.mark.asyncio
@pytest.mark.xfail(
    reason="runtime recursive tool policy changed after SkillRegistry unification",
    run=False,
    strict=False,
)
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

    _patch_run_code_stream(monkeypatch, _fake_run_code)

    result = await plugin.handle_execute_code_plan(
        code="deeting.call_tool('search_sdk', query='x')"
    )

    assert result["status"] == "failed"
    assert result["error_code"] == "CODE_MODE_RUNTIME_TOOL_CALL_INVALID"


@pytest.mark.asyncio
async def test_execute_code_plan_tool_plan_rejects_tool_not_in_latest_search_results(
    monkeypatch,
):
    plugin = _make_plugin()

    async def _fake_build_tool_candidates(*, user_id, query):
        return [
            ToolDefinition(
                name="fetch_web_content",
                description="Fetch web content",
                input_schema={
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                },
            ),
            ToolDefinition(
                name="crawl_website",
                description="Crawl website",
                input_schema={
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                },
            ),
        ]

    monkeypatch.setattr(plugin, "_build_tool_candidates", _fake_build_tool_candidates)

    wf_ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        user_id=str(plugin.context.user_id),
        session_id="sess-1",
    )
    await plugin.handle_search_sdk("抓取网页", limit=1, __context__=wf_ctx)

    result = await plugin.handle_execute_code_plan(
        code="deeting.log('x')",
        tool_plan=[{"tool_name": "crawl_website", "arguments": {"url": "https://x.com"}}],
        __context__=wf_ctx,
    )

    assert result["status"] == "failed"
    assert result["error_code"] == "CODE_MODE_TOOL_PLAN_INVALID"
    assert any("not in latest search_sdk results" in item for item in result["violations"])


@pytest.mark.asyncio
@pytest.mark.xfail(
    reason="search snapshot enforcement semantics changed in current runtime",
    run=False,
    strict=False,
)
async def test_execute_code_plan_runtime_call_tool_rejects_not_in_latest_search_results(
    monkeypatch,
):
    plugin = _make_plugin()

    async def _fake_build_tool_candidates(*, user_id, query):
        return [
            ToolDefinition(
                name="fetch_web_content",
                description="Fetch web content",
                input_schema={
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                },
            ),
            ToolDefinition(
                name="crawl_website",
                description="Crawl website",
                input_schema={
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                },
            ),
        ]

    async def _fake_run_code(session_id, code, language, execution_timeout):
        marker = sdk_module._RUNTIME_TOOL_CALL_MARKER + json.dumps(
            {
                "index": 0,
                "tool_name": "crawl_website",
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

    monkeypatch.setattr(plugin, "_build_tool_candidates", _fake_build_tool_candidates)
    _patch_run_code_stream(monkeypatch, _fake_run_code)

    wf_ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        user_id=str(plugin.context.user_id),
        session_id="sess-1",
    )
    await plugin.handle_search_sdk("抓取网页", limit=1, __context__=wf_ctx)

    result = await plugin.handle_execute_code_plan(
        code="deeting.call_tool('crawl_website', url='https://example.com')",
        __context__=wf_ctx,
    )

    assert result["status"] == "failed"
    assert result["error_code"] == "CODE_MODE_RUNTIME_TOOL_CALL_INVALID"
    assert "not in latest search_sdk results" in str(result.get("error") or "")


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
    _patch_run_code_stream(monkeypatch, _fake_run_code)

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


def test_build_wrapped_code_injects_deeting_module_alias():
    plugin = _make_plugin()

    wrapped = plugin._build_wrapped_code("import deeting\ndeeting.log('ok')")

    assert "types.ModuleType('deeting')" in wrapped
    assert "sys.modules['deeting'] = _deeting_module" in wrapped
