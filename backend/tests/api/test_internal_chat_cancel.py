import asyncio
from types import SimpleNamespace

import pytest
from httpx import AsyncClient

from app.api.v1.internal.gateway import _status_stream_chat
from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.services.orchestrator.context import Channel, ErrorSource, WorkflowContext
from app.services.system import CancelService


@pytest.mark.asyncio
async def test_internal_chat_cancel_sets_cache(
    client: AsyncClient,
    auth_tokens: dict,
    test_user: dict,
):
    request_id = "req-cancel-001"

    resp = await client.post(
        f"/api/v1/internal/chat/completions/{request_id}/cancel",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["request_id"] == request_id
    assert data["status"] == "canceled"

    cached = await cache.get(
        CacheKeys.request_cancel("chat", str(test_user["id"]), request_id)
    )
    assert cached is True


@pytest.mark.asyncio
async def test_status_stream_disconnect_cancels_background_task():
    started = asyncio.Event()
    stopped = asyncio.Event()

    class DummyOrchestrator:
        async def execute(self, _ctx):
            started.set()
            try:
                await asyncio.sleep(30)
            finally:
                stopped.set()
            return SimpleNamespace(success=True)

    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        capability="chat",
        user_id="user-disconnect-001",
    )
    ctx.set("request", "request_id", "req-disconnect-001")

    stream = _status_stream_chat(ctx, DummyOrchestrator())
    first_chunk = await anext(stream)
    assert b'"type": "status"' in first_chunk
    await asyncio.wait_for(started.wait(), timeout=1.0)

    await stream.aclose()
    await asyncio.wait_for(stopped.wait(), timeout=1.0)
    assert ctx.error_source == ErrorSource.CLIENT
    assert ctx.error_code == "CLIENT_DISCONNECTED"


@pytest.mark.asyncio
async def test_status_stream_cancel_signal_stops_background_task():
    started = asyncio.Event()
    stopped = asyncio.Event()

    class DummyOrchestrator:
        async def execute(self, _ctx):
            started.set()
            try:
                await asyncio.sleep(30)
            finally:
                stopped.set()
            return SimpleNamespace(success=True)

    user_id = "user-cancel-001"
    request_id = "req-cancel-stream-001"
    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        capability="chat",
        user_id=user_id,
    )
    ctx.set("request", "request_id", request_id)

    stream = _status_stream_chat(ctx, DummyOrchestrator())
    _ = await anext(stream)
    await asyncio.wait_for(started.wait(), timeout=1.0)

    cancel_service = CancelService()
    await cancel_service.mark_cancel(
        capability="chat",
        user_id=user_id,
        request_id=request_id,
    )

    done_chunk = b""
    async for chunk in stream:
        done_chunk = chunk
        if b"[DONE]" in chunk:
            break

    await stream.aclose()
    await asyncio.wait_for(stopped.wait(), timeout=1.0)
    assert b"[DONE]" in done_chunk
    assert ctx.error_source == ErrorSource.CLIENT
    assert ctx.error_code == "CLIENT_CANCELLED"
