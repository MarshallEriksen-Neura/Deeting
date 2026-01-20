import asyncio
import json
import uuid

import pytest

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps import upstream_call as upstream_call_module
from app.services.workflow.steps.upstream_call import (
    StreamTokenAccumulator,
    UpstreamCallStep,
    _jsonify_payload,
    stream_with_billing,
)


def test_stream_token_accumulator_parses_chunks_and_done():
    accumulator = StreamTokenAccumulator()
    chunk = (
        b'data: {"model":"gpt-4","choices":[{"finish_reason":"stop"}],'
        b'"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n'
    )
    accumulator.parse_sse_chunk(chunk)
    accumulator.parse_sse_chunk(b"data: [DONE]\n\n")

    assert accumulator.model == "gpt-4"
    assert accumulator.finish_reason == "stop"
    assert accumulator.input_tokens == 10
    assert accumulator.output_tokens == 5
    assert accumulator.is_completed is True


def test_stream_token_accumulator_estimates_tokens_when_missing_usage():
    accumulator = StreamTokenAccumulator()
    accumulator.parse_sse_chunk(b"data: {\"choices\": [{\"delta\": {\"content\": \"hi\"}}]}\n\n")
    assert accumulator.output_tokens == 0
    # 无 usage 时根据 chunk 数估算
    assert accumulator.estimate_output_tokens() >= 1


def test_jsonify_payload_converts_uuid():
    payload = {"assistant_id": uuid.uuid4(), "nested": {"ids": [uuid.uuid4()]}}
    result = _jsonify_payload(payload)

    assert isinstance(result["assistant_id"], str)
    assert isinstance(result["nested"]["ids"][0], str)


@pytest.mark.asyncio
async def test_call_upstream_handles_non_json_response(monkeypatch):
    class DummyResponse:
        status_code = 200
        headers = {"content-type": "text/plain"}
        content = b"OK"
        text = "OK"

        def raise_for_status(self) -> None:
            return None

        def json(self):
            raise json.JSONDecodeError("Expecting value", "", 0)

    class DummyClient:
        async def aclose(self) -> None:
            return None

    class DummyProxyPool:
        async def pick(self, **_):
            return None

        def build_transport_kwargs(self, _selection):
            return {}

    async def fake_request_with_redirects(*_args, **_kwargs):
        return DummyResponse()

    step = UpstreamCallStep()
    step.proxy_pool = DummyProxyPool()
    ctx = WorkflowContext(channel=Channel.INTERNAL)

    monkeypatch.setattr(step, "_request_with_redirects", fake_request_with_redirects)
    monkeypatch.setattr(upstream_call_module, "create_async_http_client", lambda **_: DummyClient())

    result = await step._call_upstream(
        ctx=ctx,
        url="https://api.example.com",
        body={"hello": "world"},
        headers={},
        timeout=1.0,
        method="POST",
    )

    assert result["status_code"] == 200
    assert result["body"] == {"raw_text": "OK"}


@pytest.mark.asyncio
async def test_stream_with_billing_updates_context_and_invokes_callback():
    async def fake_stream():
        yield (
            b'data: {"model":"gpt-4","usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n'
        )
        yield b"data: [DONE]\n\n"

    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    accumulator = StreamTokenAccumulator()
    called = {}

    async def on_complete(inner_ctx, acc):
        called["tokens"] = (acc.input_tokens, acc.output_tokens)
        called["trace_id"] = inner_ctx.trace_id

    collected = []
    async for chunk in stream_with_billing(
        fake_stream(), ctx, accumulator, on_complete=on_complete
    ):
        collected.append(chunk)

    assert collected  # 数据被透传
    assert ctx.billing.input_tokens == 3
    assert ctx.billing.output_tokens == 2
    assert called["tokens"] == (3, 2)
    assert called["trace_id"] == ctx.trace_id
