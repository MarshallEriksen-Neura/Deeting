from types import SimpleNamespace

import pytest

from app.deps.auth import get_current_user
from app.services.orchestrator.orchestrator import get_internal_orchestrator
from main import app


class _FakeResponsesOrchestrator:
    async def execute(self, ctx):
        ctx.is_success = True
        ctx.set(
            "response_transform",
            "response",
            {
                "id": "chatcmpl_test",
                "object": "chat.completion",
                "model": ctx.requested_model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "pong from chat"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 3,
                    "completion_tokens": 4,
                    "total_tokens": 7,
                },
            },
        )
        ctx.set("upstream_call", "status_code", 200)
        return SimpleNamespace(success=True)


@pytest.mark.asyncio
async def test_internal_responses_route_renders_responses_payload(client):
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="user-1")
    app.dependency_overrides[get_internal_orchestrator] = (
        lambda: _FakeResponsesOrchestrator()
    )
    try:
        resp = await client.post(
            "/api/v1/internal/responses",
            json={
                "model": "gpt-5.3-codex",
                "provider_model_id": "11111111-1111-1111-1111-111111111111",
                "input": "hello",
            },
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_internal_orchestrator, None)

    assert resp.status_code == 200
    data = resp.json()
    assert data["object"] == "response"
    assert data["model"] == "gpt-5.3-codex"
    assert data["output"][0]["content"][0]["text"] == "pong from chat"


@pytest.mark.asyncio
async def test_internal_responses_route_rejects_streaming_for_now(client):
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="user-1")
    app.dependency_overrides[get_internal_orchestrator] = (
        lambda: _FakeResponsesOrchestrator()
    )
    try:
        resp = await client.post(
            "/api/v1/internal/responses",
            json={
                "model": "gpt-5.3-codex",
                "provider_model_id": "11111111-1111-1111-1111-111111111111",
                "input": "hello",
                "stream": True,
            },
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_internal_orchestrator, None)

    assert resp.status_code == 400
    assert resp.json()["code"] == "RESPONSES_STREAM_UNSUPPORTED"
