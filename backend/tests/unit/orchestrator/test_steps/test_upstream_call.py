import json
import uuid
from types import SimpleNamespace

import pytest

from app.core.cache import cache
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.providers.blocks_transformer import extract_stream_blocks
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
    accumulator.parse_sse_chunk(
        b'data: {"choices": [{"delta": {"content": "hi"}}]}\n\n'
    )
    assert accumulator.output_tokens == 0
    # 无 usage 时根据 chunk 数估算
    assert accumulator.estimate_output_tokens() >= 1


def test_jsonify_payload_converts_uuid():
    payload = {"assistant_id": uuid.uuid4(), "nested": {"ids": [uuid.uuid4()]}}
    result = _jsonify_payload(payload)

    assert isinstance(result["assistant_id"], str)
    assert isinstance(result["nested"]["ids"][0], str)


def test_extract_stream_blocks_from_reasoning_delta():
    payload = {"choices": [{"delta": {"reasoning_content": "think"}}]}
    blocks = extract_stream_blocks(payload, stream_transform=None)
    assert blocks == [{"type": "thought", "content": "think"}]


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
    monkeypatch.setattr(
        upstream_call_module, "create_async_http_client", lambda **_: DummyClient()
    )

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


@pytest.mark.asyncio
async def test_update_provider_health_records_when_instance_available(monkeypatch):
    class DummyHealthMonitorService:
        calls = []

        def __init__(self, redis_client):
            self.redis_client = redis_client

        async def record_request_result(
            self,
            instance_id: str | None,
            *,
            status_code: int | None,
            latency_ms: float | int | None,
            error_code: str | None = None,
        ) -> None:
            self.calls.append(
                {
                    "instance_id": instance_id,
                    "status_code": status_code,
                    "latency_ms": latency_ms,
                    "error_code": error_code,
                }
            )

    step = UpstreamCallStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.selected_instance_id = "inst-health-1"

    original_redis = getattr(cache, "_redis", None)
    cache._redis = object()
    monkeypatch.setattr(
        upstream_call_module, "HealthMonitorService", DummyHealthMonitorService
    )
    try:
        await step._update_provider_health(
            ctx,
            status_code=200,
            latency_ms=88.0,
            error_code=None,
        )
    finally:
        cache._redis = original_redis

    assert len(DummyHealthMonitorService.calls) == 1
    assert DummyHealthMonitorService.calls[0]["instance_id"] == "inst-health-1"
    assert DummyHealthMonitorService.calls[0]["status_code"] == 200


@pytest.mark.asyncio
async def test_update_provider_health_skips_without_instance(monkeypatch):
    class DummyHealthMonitorService:
        calls = []

        def __init__(self, redis_client):
            self.redis_client = redis_client

        async def record_request_result(
            self,
            instance_id: str | None,
            *,
            status_code: int | None,
            latency_ms: float | int | None,
            error_code: str | None = None,
        ) -> None:
            self.calls.append(instance_id)

    step = UpstreamCallStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)

    original_redis = getattr(cache, "_redis", None)
    cache._redis = object()
    monkeypatch.setattr(
        upstream_call_module, "HealthMonitorService", DummyHealthMonitorService
    )
    try:
        await step._update_provider_health(
            ctx,
            status_code=500,
            latency_ms=120.0,
            error_code="UPSTREAM_500",
        )
    finally:
        cache._redis = original_redis

    assert DummyHealthMonitorService.calls == []


@pytest.mark.asyncio
async def test_record_bandit_feedback_fallbacks_to_provider_model_id(monkeypatch):
    calls: list[dict] = []

    class DummyBanditRepository:
        def __init__(self, _session):
            pass

        async def record_feedback(self, **kwargs):
            calls.append(kwargs)

    step = UpstreamCallStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.db_session = SimpleNamespace()
    ctx.selected_provider_model_id = "59968e6d-10f5-4967-aefc-d68f85ce7d35"
    ctx.billing.total_cost = 1.25
    ctx.set("routing", "routing_config", {"strategy": "bandit"})

    monkeypatch.setattr(upstream_call_module, "BanditRepository", DummyBanditRepository)

    await step._record_bandit_feedback(ctx, success=True, latency_ms=123.0)

    assert len(calls) == 1
    assert calls[0]["arm_id"] == "59968e6d-10f5-4967-aefc-d68f85ce7d35"
    assert calls[0]["success"] is True
    assert calls[0]["latency_ms"] == 123.0


@pytest.mark.asyncio
async def test_record_bandit_feedback_skips_without_any_arm_id(monkeypatch):
    calls: list[dict] = []

    class DummyBanditRepository:
        def __init__(self, _session):
            pass

        async def record_feedback(self, **kwargs):
            calls.append(kwargs)

    step = UpstreamCallStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.db_session = SimpleNamespace()
    ctx.selected_provider_model_id = None

    monkeypatch.setattr(upstream_call_module, "BanditRepository", DummyBanditRepository)

    await step._record_bandit_feedback(ctx, success=True, latency_ms=100.0)

    assert calls == []


def test_upstream_call_builds_template_render_state_from_canonical_request():
    step = UpstreamCallStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set(
        "protocol",
        "canonical_request",
        SimpleNamespace(
            model_dump=lambda exclude_none=True: {
                "model": "gpt-5.3-codex",
                "messages": [{"role": "user", "content": "hello upstream"}],
                "stream": False,
                "temperature": 0.1,
                "max_output_tokens": 32,
                "tools": [{"type": "function", "function": {"name": "search_sdk"}}],
            }
        ),
    )
    ctx.set("routing", "upstream_url", "https://api.example.com/v1/chat/completions")
    ctx.set(
        "routing",
        "protocol_profile",
        {"defaults": {"headers": {"X-Upstream": "fallback"}}},
    )

    step._ensure_template_render_state(ctx)

    assert (
        ctx.get("template_render", "upstream_url")
        == "https://api.example.com/v1/chat/completions"
    )
    assert ctx.get("template_render", "headers") == {"X-Upstream": "fallback"}
    assert ctx.get("template_render", "request_body") == {
        "model": "gpt-5.3-codex",
        "messages": [{"role": "user", "content": "hello upstream"}],
        "stream": False,
        "temperature": 0.1,
        "max_tokens": 32,
        "tools": [{"type": "function", "function": {"name": "search_sdk"}}],
    }
