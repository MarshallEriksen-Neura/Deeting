"""
测试 v2 协议转换层（非流式）
"""

from __future__ import annotations

import pytest

from app.api.v1.chat.protocol_adapter import adapt_request_payload, adapt_response_payload


def test_adapt_request_openai_to_claude_basic():
    payload = {
        "model": "gpt-4",
        "messages": [
            {"role": "system", "content": "you are helpful"},
            {"role": "user", "content": "hi"},
        ],
        "stop": ["\n\nUser:"],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "get weather",
                    "parameters": {"type": "object", "properties": {"city": {"type": "string"}}},
                },
            }
        ],
    }

    adapted = adapt_request_payload(
        payload,
        from_style="openai",
        to_style="claude",
        upstream_model_id="claude-3-5-sonnet",
    )

    assert adapted["model"] == "claude-3-5-sonnet"
    assert isinstance(adapted.get("system"), list)
    assert adapted["system"][0]["type"] == "text"
    assert "stop_sequences" in adapted
    assert "stop" not in adapted
    assert isinstance(adapted.get("messages"), list)
    assert adapted["messages"][0]["role"] == "user"
    assert isinstance(adapted["messages"][0]["content"], list)
    assert adapted["messages"][0]["content"][0]["type"] == "text"
    assert isinstance(adapted.get("tools"), list)
    assert adapted["tools"][0]["name"] == "get_weather"
    assert "input_schema" in adapted["tools"][0]


def test_adapt_request_claude_to_openai_basic():
    payload = {
        "model": "claude-3",
        "system": "you are helpful",
        "messages": [{"role": "user", "content": [{"type": "text", "text": "hi"}]}],
        "max_tokens": 16,
    }
    adapted = adapt_request_payload(
        payload,
        from_style="claude",
        to_style="openai",
        upstream_model_id="gpt-4o-mini",
    )
    assert adapted["model"] == "gpt-4o-mini"
    assert isinstance(adapted.get("messages"), list)
    assert adapted["messages"][0]["role"] == "system"
    assert adapted["messages"][1]["role"] == "user"


def test_adapt_response_claude_to_openai_basic():
    claude_resp = {
        "id": "msg_123",
        "content": [{"type": "text", "text": "Hello!"}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    }
    adapted = adapt_response_payload(
        claude_resp,
        from_style="claude",
        to_style="openai",
        request_model="claude-3",
    )
    assert isinstance(adapted, dict)
    assert "choices" in adapted
    assert adapted["choices"][0]["message"]["content"]


def test_adapt_response_openai_to_responses_basic():
    openai_resp = {
        "id": "chatcmpl_1",
        "object": "chat.completion",
        "created": 1,
        "model": "gpt-4",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }
    adapted = adapt_response_payload(
        openai_resp,
        from_style="openai",
        to_style="responses",
        request_model="gpt-4",
    )
    assert isinstance(adapted, dict)
    assert adapted.get("object") == "response"
    assert "output" in adapted


@pytest.mark.parametrize("from_style,to_style", [("openai", "responses"), ("claude", "responses")])
def test_adapt_request_to_responses_is_not_supported(from_style, to_style):
    with pytest.raises(ValueError):
        adapt_request_payload(
            {"model": "m", "messages": [{"role": "user", "content": "hi"}]},
            from_style=from_style,
            to_style=to_style,
            upstream_model_id="m2",
        )

