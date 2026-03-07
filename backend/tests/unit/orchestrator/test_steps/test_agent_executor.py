import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.schemas.tool import ToolCall
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.agent_executor import AgentExecutorStep
from app.services.workflow.steps.base import StepConfig, StepResult, StepStatus


def test_trim_tool_result_for_history_within_limit(monkeypatch):
    step = AgentExecutorStep()
    monkeypatch.setattr(settings, "AGENT_TOOL_RESULT_MAX_CHARS", 2000, raising=False)

    raw = "ok"
    trimmed, truncated = step._trim_tool_result_for_history(raw)

    assert truncated is False
    assert trimmed == raw


def test_resolve_tool_call_timeout_uses_step_timeout_cap(monkeypatch):
    step = AgentExecutorStep(config=StepConfig(timeout=180.0))

    monkeypatch.setattr(
        settings, "AGENT_TOOL_CALL_TIMEOUT_SECONDS", 300.0, raising=False
    )
    assert step._resolve_tool_call_timeout_seconds() == pytest.approx(180.0)

    monkeypatch.setattr(
        settings, "AGENT_TOOL_CALL_TIMEOUT_SECONDS", 90.0, raising=False
    )
    assert step._resolve_tool_call_timeout_seconds() == pytest.approx(90.0)


def test_resolve_max_turns_uses_request_value_within_hard_limit(monkeypatch):
    step = AgentExecutorStep(config=StepConfig(max_turns=24))
    monkeypatch.setattr(settings, "AGENT_EXECUTOR_MAX_TURNS_HARD_LIMIT", 60, raising=False)

    assert step._resolve_max_turns({"max_turns": 48}) == 48


def test_resolve_max_turns_clamps_to_hard_limit(monkeypatch):
    step = AgentExecutorStep(config=StepConfig(max_turns=24))
    monkeypatch.setattr(settings, "AGENT_EXECUTOR_MAX_TURNS_HARD_LIMIT", 20, raising=False)

    assert step._resolve_max_turns({"max_turns": 99}) == 20


def test_resolve_max_turns_falls_back_when_request_invalid(monkeypatch):
    step = AgentExecutorStep(config=StepConfig(max_turns=18))
    monkeypatch.setattr(settings, "AGENT_EXECUTOR_MAX_TURNS_HARD_LIMIT", 60, raising=False)

    assert step._resolve_max_turns({"max_turns": "bad"}) == 18
    assert step._resolve_max_turns({"max_turns": 0}) == 18


def test_should_block_direct_tool_call_when_code_mode_available():
    step = AgentExecutorStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set(
        "template_render",
        "request_body",
        {
            "tools": [
                {"type": "function", "function": {"name": "search_sdk"}},
                {"type": "function", "function": {"name": "execute_code_plan"}},
                {"type": "function", "function": {"name": "activate_assistant"}},
                {"type": "function", "function": {"name": "deactivate_assistant"}},
                {"type": "function", "function": {"name": "tavily-search"}},
            ]
        },
    )

    user_map = {"tavily-search": {"sse_url": "https://example.com", "headers": {}}}
    assert (
        step._should_block_direct_tool_call(
            ctx,
            tool_name="tavily-search",
            user_mcp_tool_map=user_map,
        )
        is True
    )
    assert (
        step._should_block_direct_tool_call(
            ctx,
            tool_name="skill__com.deeting.example.weather",
            user_mcp_tool_map={},
        )
        is True
    )
    assert (
        step._should_block_direct_tool_call(
            ctx,
            tool_name="fetch_web_content",
            user_mcp_tool_map={},
        )
        is True
    )
    assert (
        step._should_block_direct_tool_call(
            ctx,
            tool_name="consult_expert_network",
            user_mcp_tool_map={},
        )
        is False
    )
    assert (
        step._should_block_direct_tool_call(
            ctx,
            tool_name="search_knowledge",
            user_mcp_tool_map={},
        )
        is False
    )
    assert (
        step._should_block_direct_tool_call(
            ctx,
            tool_name="search_sdk",
            user_mcp_tool_map=user_map,
        )
        is False
    )
    assert (
        step._should_block_direct_tool_call(
            ctx,
            tool_name="activate_assistant",
            user_mcp_tool_map={},
        )
        is False
    )
    assert (
        step._should_block_direct_tool_call(
            ctx,
            tool_name="deactivate_assistant",
            user_mcp_tool_map={},
        )
        is False
    )


def test_should_not_block_direct_tool_call_when_code_mode_unavailable():
    step = AgentExecutorStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set(
        "template_render",
        "request_body",
        {"tools": [{"type": "function", "function": {"name": "tavily-search"}}]},
    )

    user_map = {"tavily-search": {"sse_url": "https://example.com", "headers": {}}}
    assert (
        step._should_block_direct_tool_call(
            ctx,
            tool_name="tavily-search",
            user_mcp_tool_map=user_map,
        )
        is False
    )


def test_consume_pending_assistant_transition_applies_activation_payload():
    step = AgentExecutorStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set(
        "assistant_activation",
        "pending",
        {
            "action": "activated",
            "assistant_id": "assistant-1",
            "assistant_name": "Expert",
            "system_prompt": "You are the activated expert.",
            "skill_tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "expert_lookup",
                        "description": "lookup",
                        "parameters": {"type": "object", "properties": {}},
                    },
                }
            ],
            "reason": "best match",
        },
    )
    request_body = {
        "tools": [
            {"type": "function", "function": {"name": "search_sdk"}},
            {"type": "function", "function": {"name": "execute_code_plan"}},
            {"type": "function", "function": {"name": "activate_assistant"}},
            {"type": "function", "function": {"name": "deactivate_assistant"}},
        ]
    }
    messages: list[dict] = []

    block, assistant_id = step._consume_pending_assistant_transition(
        ctx,
        request_body=request_body,
        messages=messages,
        base_tools=deepcopy(request_body["tools"]),
    )

    assert assistant_id == "assistant-1"
    assert block["type"] == "assistant_transition"
    assert block["action"] == "activated"
    assert request_body["tools"][-1]["function"]["name"] == "expert_lookup"
    assert messages[-1]["role"] == "system"
    assert "Assistant Activated: Expert" in messages[-1]["content"]


def test_consume_pending_assistant_transition_applies_deactivation_payload():
    step = AgentExecutorStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set(
        "assistant_activation",
        "pending",
        {
            "action": "deactivated",
            "assistant_id": "assistant-1",
            "assistant_name": "Expert",
            "reason": "done",
        },
    )
    base_tools = [
        {"type": "function", "function": {"name": "search_sdk"}},
        {"type": "function", "function": {"name": "execute_code_plan"}},
        {"type": "function", "function": {"name": "activate_assistant"}},
        {"type": "function", "function": {"name": "deactivate_assistant"}},
    ]
    request_body = {
        "tools": [
            *deepcopy(base_tools),
            {"type": "function", "function": {"name": "expert_lookup"}},
        ]
    }
    messages: list[dict] = []

    block, assistant_id = step._consume_pending_assistant_transition(
        ctx,
        request_body=request_body,
        messages=messages,
        base_tools=deepcopy(base_tools),
    )

    assert assistant_id is None
    assert block["action"] == "deactivated"
    assert request_body["tools"] == base_tools
    assert "Assistant Deactivated" in messages[-1]["content"]


@pytest.mark.asyncio
async def test_dispatch_tool_timeout_uses_dynamic_config(monkeypatch):
    step = AgentExecutorStep(config=StepConfig(timeout=180.0))
    monkeypatch.setattr(
        settings, "AGENT_TOOL_CALL_TIMEOUT_SECONDS", 0.1, raising=False
    )

    async def slow_inner(*_args, **_kwargs):
        await asyncio.sleep(0.2)
        return {"ok": True}

    monkeypatch.setattr(step, "_dispatch_tool_inner", slow_inner)

    ctx = WorkflowContext(channel=Channel.INTERNAL)
    tool_call = ToolCall(
        id="tool_1",
        name="crawl_website",
        arguments={"url": "https://example.com"},
    )

    result = await step._dispatch_tool(ctx, tool_call, {})

    assert "error" in result
    assert "timed out after 0.1s" in result["error"]


@pytest.mark.asyncio
async def test_dispatch_tool_inner_executes_skill_registry_tool(monkeypatch):
    step = AgentExecutorStep()
    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        user_id="11111111-1111-1111-1111-111111111111",
        session_id="sess_123",
    )
    ctx.set("template_render", "request_body", {"tools": []})
    tool_call = ToolCall(
        id="tool_1",
        name="fetch_web_content",
        arguments={"url": "https://example.com"},
    )

    class _FakeSessionCtx:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class _FakeRepo:
        def __init__(self, _session):
            pass

        async def get_by_tool_name(self, tool_name: str):
            assert tool_name == "fetch_web_content"
            return SimpleNamespace(id="official.skills.crawler")

    captured: dict[str, object] = {}

    class _FakeExecutor:
        def __init__(self, _repo):
            pass

        async def execute(self, **kwargs):
            captured.update(kwargs)
            return {"status": "ok", "result": {"status": "ok"}}

    monkeypatch.setattr("app.core.database.AsyncSessionLocal", lambda: _FakeSessionCtx())
    monkeypatch.setattr(
        "app.repositories.skill_registry_repository.SkillRegistryRepository", _FakeRepo
    )
    monkeypatch.setattr(
        "app.services.skill_registry.skill_runtime_executor.SkillRuntimeExecutor",
        _FakeExecutor,
    )

    result = await step._dispatch_tool_inner(ctx, tool_call, {})

    assert result == {"status": "ok"}
    assert captured["skill_id"] == "official.skills.crawler"
    assert captured["session_id"] == "sess_123"
    assert captured["intent"] == "fetch_web_content"
    assert captured["inputs"] == {
        "url": "https://example.com",
        "__tool_name__": "fetch_web_content",
    }


@pytest.mark.asyncio
async def test_dispatch_tool_inner_returns_skill_registry_error(monkeypatch):
    step = AgentExecutorStep()
    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        user_id="11111111-1111-1111-1111-111111111111",
    )
    ctx.set("template_render", "request_body", {"tools": []})
    tool_call = ToolCall(
        id="tool_1",
        name="fetch_web_content",
        arguments={},
    )

    class _FakeSessionCtx:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class _FakeRepo:
        def __init__(self, _session):
            pass

        async def get_by_tool_name(self, _tool_name: str):
            return SimpleNamespace(id="official.skills.crawler")

    class _FakeExecutor:
        def __init__(self, _repo):
            pass

        async def execute(self, **kwargs):
            return {"status": "error", "error": "boom"}

    monkeypatch.setattr("app.core.database.AsyncSessionLocal", lambda: _FakeSessionCtx())
    monkeypatch.setattr(
        "app.repositories.skill_registry_repository.SkillRegistryRepository", _FakeRepo
    )
    monkeypatch.setattr(
        "app.services.skill_registry.skill_runtime_executor.SkillRuntimeExecutor",
        _FakeExecutor,
    )

    result = await step._dispatch_tool_inner(ctx, tool_call, {})
    assert result == {"error": "boom"}


@pytest.mark.asyncio
async def test_dispatch_tool_inner_routes_core_sdk_tools_to_core_plugin(monkeypatch):
    from app.services.agent.agent_service import agent_service

    step = AgentExecutorStep()
    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        user_id="11111111-1111-1111-1111-111111111111",
    )
    ctx.set("template_render", "request_body", {"tools": []})
    tool_call = ToolCall(
        id="tool_core_1",
        name="search_sdk",
        arguments={"query": "fetch repository readme"},
    )

    class _FakeCorePlugin:
        async def handle_search_sdk(self, query: str, __context__=None):
            assert query == "fetch repository readme"
            assert __context__ is ctx
            return {"source": "core_plugin"}

    monkeypatch.setattr(
        agent_service.plugin_manager,
        "get_plugin",
        lambda name: _FakeCorePlugin() if name == "system.deeting_core_sdk" else None,
    )

    result = await step._dispatch_tool_inner(ctx, tool_call, {})
    assert result == {"source": "core_plugin"}


@pytest.mark.asyncio
async def test_execute_truncates_tool_result_in_history(monkeypatch):
    step = AgentExecutorStep()
    monkeypatch.setattr(settings, "AGENT_TOOL_RESULT_MAX_CHARS", 600, raising=False)

    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set(
        "template_render",
        "request_body",
        {
            "messages": [{"role": "user", "content": "请抓取并总结网页"}],
            "stream": False,
            "max_turns": 3,
        },
    )

    upstream_requests: list[list[dict]] = []
    tool_payload = "A" * 5000

    async def fake_upstream_execute(inner_ctx):
        request_body = inner_ctx.get("template_render", "request_body") or {}
        upstream_requests.append(deepcopy(request_body.get("messages", [])))

        if len(upstream_requests) == 1:
            inner_ctx.set(
                "upstream_call",
                "response",
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "tc_1",
                                        "function": {
                                            "name": "fetch_web_content",
                                            "arguments": '{"url":"https://example.com"}',
                                        },
                                    }
                                ],
                            }
                        }
                    ]
                },
            )
        else:
            inner_ctx.set(
                "upstream_call",
                "response",
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "已完成",
                            }
                        }
                    ]
                },
            )
        return StepResult(status=StepStatus.SUCCESS)

    async def fake_build_user_map(_ctx):
        return {}

    async def fake_dispatch_tool(_ctx, _tool_call, _tool_map):
        return {"status": "success", "markdown": tool_payload}

    monkeypatch.setattr(step.upstream_step, "execute", fake_upstream_execute)
    monkeypatch.setattr(step, "_build_user_mcp_tool_map", fake_build_user_map)
    monkeypatch.setattr(step, "_dispatch_tool", fake_dispatch_tool)

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    assert len(upstream_requests) >= 2

    second_turn_msgs = upstream_requests[1]
    tool_messages = [m for m in second_turn_msgs if m.get("role") == "tool"]
    assert tool_messages
    tool_content = tool_messages[0]["content"]

    assert "[tool_result_truncated omitted_chars=" in tool_content
    assert len(tool_content) < len(tool_payload)

    tool_calls_log = ctx.get("execution", "tool_calls") or []
    assert tool_calls_log
    assert tool_calls_log[0]["truncated"] is True
    assert "[tool_result_truncated omitted_chars=" in tool_calls_log[0]["output"]


@pytest.mark.asyncio
async def test_execute_sanitizes_malformed_tool_arguments_in_history(monkeypatch):
    step = AgentExecutorStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set(
        "template_render",
        "request_body",
        {
            "messages": [{"role": "user", "content": "请执行代码计划"}],
            "stream": False,
            "max_turns": 3,
        },
    )

    upstream_requests: list[list[dict]] = []

    async def fake_upstream_execute(inner_ctx):
        request_body = inner_ctx.get("template_render", "request_body") or {}
        upstream_requests.append(deepcopy(request_body.get("messages", [])))

        if len(upstream_requests) == 1:
            inner_ctx.set(
                "upstream_call",
                "response",
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "tc_bad_1",
                                        "function": {
                                            "name": "execute_code_plan",
                                            "arguments": '{"code":"C:\\q"}',
                                        },
                                    }
                                ],
                            }
                        }
                    ]
                },
            )
        else:
            inner_ctx.set(
                "upstream_call",
                "response",
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "参数已修正",
                            }
                        }
                    ]
                },
            )
        return StepResult(status=StepStatus.SUCCESS)

    async def fake_build_user_map(_ctx):
        return {}

    async def fake_dispatch_tool(_ctx, _tool_call, _tool_map):
        raise AssertionError("Malformed tool arguments should not dispatch tool execution.")

    monkeypatch.setattr(step.upstream_step, "execute", fake_upstream_execute)
    monkeypatch.setattr(step, "_build_user_mcp_tool_map", fake_build_user_map)
    monkeypatch.setattr(step, "_dispatch_tool", fake_dispatch_tool)

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    assert len(upstream_requests) >= 2

    second_turn_msgs = upstream_requests[1]
    assistant_msg = next(
        m
        for m in second_turn_msgs
        if m.get("role") == "assistant" and isinstance(m.get("tool_calls"), list)
    )
    assert assistant_msg["tool_calls"][0]["function"]["arguments"] == "{}"

    tool_msg = next(m for m in second_turn_msgs if m.get("role") == "tool")
    assert tool_msg["tool_call_id"] == "tc_bad_1"
    assert "Failed to parse tool call arguments as JSON" in tool_msg["content"]


@pytest.mark.asyncio
async def test_execute_emits_ui_blocks_from_tool_result(monkeypatch):
    step = AgentExecutorStep()
    emitted: list[dict] = []

    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.status_emitter = lambda payload: emitted.append(payload)
    ctx.set(
        "template_render",
        "request_body",
        {
            "messages": [{"role": "user", "content": "生成表格"}],
            "stream": True,
            "max_turns": 3,
        },
    )

    upstream_requests: list[list[dict]] = []

    async def fake_upstream_execute(inner_ctx):
        request_body = inner_ctx.get("template_render", "request_body") or {}
        upstream_requests.append(deepcopy(request_body.get("messages", [])))

        if len(upstream_requests) == 1:
            inner_ctx.set(
                "upstream_call",
                "response",
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "tc_ui_1",
                                        "function": {
                                            "name": "execute_code_plan",
                                            "arguments": '{"code":"print(1)"}',
                                        },
                                    }
                                ],
                            }
                        }
                    ]
                },
            )
        else:
            inner_ctx.set(
                "upstream_call",
                "response",
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "渲染完成",
                            }
                        }
                    ]
                },
            )
        return StepResult(status=StepStatus.SUCCESS)

    async def fake_build_user_map(_ctx):
        return {}

    async def fake_dispatch_tool(_ctx, _tool_call, _tool_map):
        return {
            "status": "success",
            "runtime": {
                "execution_id": "exec_001",
                "runtime_tool_calls": {
                    "count": 1,
                    "calls": [
                        {
                            "index": 0,
                            "tool_name": "search_web",
                            "status": "success",
                            "duration_ms": 31,
                        }
                    ],
                },
                "render_blocks": {"count": 1, "blocks": [{"viewType": "table.simple"}]},
                "sdk_stub": {"module": "deeting_sdk", "tool_count": 3, "pyi_chars": 128},
            },
            "ui": {
                "blocks": [
                    {
                        "type": "ui",
                        "viewType": "table.simple",
                        "payload": {"rows": [{"name": "alpha", "score": 98}]},
                    }
                ]
            },
        }

    monkeypatch.setattr(step.upstream_step, "execute", fake_upstream_execute)
    monkeypatch.setattr(step, "_build_user_mcp_tool_map", fake_build_user_map)
    monkeypatch.setattr(step, "_dispatch_tool", fake_dispatch_tool)

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    tool_calls_log = ctx.get("execution", "tool_calls") or []
    assert tool_calls_log
    assert tool_calls_log[0]["ui_blocks"][0]["viewType"] == "table.simple"
    assert tool_calls_log[0]["debug"]["execution_id"] == "exec_001"
    assert tool_calls_log[0]["debug"]["runtime_tool_calls"]["count"] == 1
    assert tool_calls_log[0]["debug"]["runtime_tool_calls"]["calls"][0]["duration_ms"] == 31
    assert tool_calls_log[0]["debug"]["render_blocks"]["count"] == 1
    assert tool_calls_log[0]["debug"]["sdk_stub"]["module"] == "deeting_sdk"

    block_events = [
        event
        for event in emitted
        if isinstance(event, dict) and event.get("type") == "blocks"
    ]
    assert block_events
    flattened_blocks = []
    for event in block_events:
        flattened_blocks.extend(event.get("blocks") or [])
    assert any(
        isinstance(block, dict)
        and block.get("type") == "ui"
        and block.get("viewType") == "table.simple"
        for block in flattened_blocks
    )
    assert any(
        isinstance(block, dict)
        and block.get("type") == "tool_result"
        and isinstance(block.get("debug"), dict)
        and (block.get("debug") or {}).get("execution_id") == "exec_001"
        for block in flattened_blocks
    )
