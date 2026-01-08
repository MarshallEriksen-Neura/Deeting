import asyncio

import pytest

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.upstream_call import (
    StreamTokenAccumulator,
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
