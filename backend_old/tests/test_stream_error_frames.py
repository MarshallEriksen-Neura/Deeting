from __future__ import annotations

import json

import pytest

from app.api.v1.chat.protocol_stream_adapter import ClaudeToOpenAIStreamAdapter, adapt_stream
from app.services.chat_routing_service import OpenAIToClaudeStreamAdapter


def _decode_sse_event(chunk: bytes) -> tuple[str | None, dict]:
    text = chunk.decode("utf-8")
    event: str | None = None
    data: dict | None = None
    for line in text.splitlines():
        if line.startswith("event:"):
            event = line[len("event:") :].strip()
        if line.startswith("data:"):
            payload = line[len("data:") :].strip()
            data = json.loads(payload)
    assert isinstance(data, dict)
    return event, data


def test_openai_to_claude_emits_error_event_and_skips_finalize():
    adapter = OpenAIToClaudeStreamAdapter("gpt-4")
    chunks = adapter.process_chunk(b'data: {"error":{"message":"boom"}}\n\n')
    assert chunks
    assert chunks[0].startswith(b"event: error")
    assert b"boom" in chunks[0]
    assert adapter.finalize() == []


def test_claude_to_openai_converts_error_event_to_openai_sse():
    adapter = ClaudeToOpenAIStreamAdapter("gpt-4")
    chunks = adapter.process_chunk(
        b'event: error\ndata: {"type":"error","error":{"message":"boom"}}\n\n'
    )
    assert chunks
    assert chunks[-1] == b"data: [DONE]\n\n"
    assert any(b"upstream_error" in chunk for chunk in chunks)


@pytest.mark.asyncio
async def test_adapt_stream_openai_to_claude_error_has_no_tail_events():
    async def _iter():
        yield b'data: {"error":{"message":"boom"}}\n\n'

    out = [
        chunk
        async for chunk in adapt_stream(
            _iter(), from_style="openai", to_style="claude", request_model="gpt-4"
        )
    ]
    assert len(out) == 1
    assert out[0].startswith(b"event: error")


@pytest.mark.asyncio
async def test_adapt_stream_claude_to_openai_error_emits_done():
    async def _iter():
        yield b'event: error\ndata: {"type":"error","error":{"message":"boom"}}\n\n'

    out = [
        chunk
        async for chunk in adapt_stream(
            _iter(), from_style="claude", to_style="openai", request_model="gpt-4"
        )
    ]
    assert out[-1] == b"data: [DONE]\n\n"


def test_openai_to_claude_message_start_and_delta_usage_are_objects():
    adapter = OpenAIToClaudeStreamAdapter("gpt-4")
    chunks = adapter.process_chunk(
        b'data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n'
    )
    assert chunks
    event, data = _decode_sse_event(chunks[0])
    assert event == "message_start"
    assert isinstance(data.get("message"), dict)
    assert isinstance(data["message"].get("usage"), dict)

    tail = adapter.finalize()
    assert tail
    message_delta = next(c for c in tail if c.startswith(b"event: message_delta"))
    event, data = _decode_sse_event(message_delta)
    assert event == "message_delta"
    assert isinstance(data.get("usage"), dict)


def test_openai_to_claude_uses_upstream_usage_when_available():
    adapter = OpenAIToClaudeStreamAdapter("gpt-4")
    adapter.process_chunk(
        b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n'
    )
    tail = adapter.finalize()
    message_delta = next(c for c in tail if c.startswith(b"event: message_delta"))
    _, data = _decode_sse_event(message_delta)
    assert data["usage"] == {"input_tokens": 1, "output_tokens": 2}
