import asyncio
from copy import deepcopy

import pytest

from app.core.config import settings
from app.services.orchestrator.context import Channel, WorkflowContext
from app.schemas.tool import ToolCall
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
