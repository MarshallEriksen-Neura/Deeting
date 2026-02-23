import pytest

import app.api.v1.internal.bridge as bridge_module
from app.services.code_mode.runtime_bridge_token_service import RuntimeBridgeClaims


@pytest.mark.asyncio
async def test_internal_bridge_call_success(client, monkeypatch):
    metrics_calls = []

    async def _fake_consume_call(_token):
        return {
            "ok": True,
            "claims": RuntimeBridgeClaims(
                user_id="123e4567-e89b-12d3-a456-426614174000",
                session_id="sess-001",
                trace_id="trace-001",
            ),
            "call_index": 0,
            "max_calls": 8,
        }

    async def _fake_dispatch_code_mode_tool(*, claims, tool_name, arguments):
        assert claims.session_id == "sess-001"
        assert tool_name == "fetch_web_content"
        assert arguments["url"] == "https://example.com"
        return {"title": "Example", "url": arguments["url"]}

    def _fake_record_metric(*, tool_name, success, duration_seconds, error_code=None):
        metrics_calls.append((tool_name, success, error_code))

    monkeypatch.setattr(
        bridge_module.runtime_bridge_token_service, "consume_call", _fake_consume_call
    )
    monkeypatch.setattr(
        bridge_module, "_dispatch_code_mode_tool", _fake_dispatch_code_mode_tool
    )
    monkeypatch.setattr(bridge_module, "record_code_mode_bridge_call", _fake_record_metric)

    resp = await client.post(
        "/api/v1/internal/bridge/call",
        json={
            "tool_name": "fetch_web_content",
            "arguments": {"url": "https://example.com"},
        },
        headers={"X-Code-Mode-Execution-Token": "tok-001"},
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["ok"] is True
    assert body["result"]["title"] == "Example"
    assert body["meta"]["call_index"] == 0
    assert metrics_calls[0] == ("fetch_web_content", True, None)


@pytest.mark.asyncio
async def test_internal_bridge_call_missing_token(client):
    resp = await client.post(
        "/api/v1/internal/bridge/call",
        json={"tool_name": "fetch_web_content", "arguments": {"url": "https://example.com"}},
    )
    body = resp.json()

    assert resp.status_code == 401
    assert body["detail"]["code"] == "CODE_MODE_BRIDGE_MISSING_TOKEN"


@pytest.mark.asyncio
async def test_internal_bridge_call_rejects_recursive_tool(client, monkeypatch):
    async def _fake_consume_call(_token):
        return {
            "ok": True,
            "claims": RuntimeBridgeClaims(
                user_id="123e4567-e89b-12d3-a456-426614174000",
                session_id="sess-001",
            ),
            "call_index": 0,
            "max_calls": 8,
        }

    monkeypatch.setattr(
        bridge_module.runtime_bridge_token_service, "consume_call", _fake_consume_call
    )

    resp = await client.post(
        "/api/v1/internal/bridge/call",
        json={"tool_name": "search_sdk", "arguments": {"query": "x"}},
        headers={"X-Code-Mode-Execution-Token": "tok-002"},
    )
    body = resp.json()

    assert resp.status_code == 400
    assert body["detail"]["code"] == "CODE_MODE_BRIDGE_TOOL_NOT_ALLOWED"


@pytest.mark.asyncio
async def test_internal_bridge_call_returns_429_on_call_limit(client, monkeypatch):
    async def _fake_consume_call(_token):
        return {
            "ok": False,
            "error_code": "CODE_MODE_BRIDGE_CALL_LIMIT",
            "error": "runtime bridge call limit exceeded (8)",
        }

    monkeypatch.setattr(
        bridge_module.runtime_bridge_token_service, "consume_call", _fake_consume_call
    )

    resp = await client.post(
        "/api/v1/internal/bridge/call",
        json={"tool_name": "fetch_web_content", "arguments": {}},
        headers={"X-Code-Mode-Execution-Token": "tok-003"},
    )
    body = resp.json()

    assert resp.status_code == 429
    assert body["detail"]["code"] == "CODE_MODE_BRIDGE_CALL_LIMIT"


@pytest.mark.asyncio
async def test_internal_bridge_call_scope_denied(client, monkeypatch):
    async def _fake_consume_call(_token):
        return {
            "ok": True,
            "claims": RuntimeBridgeClaims(
                user_id="123e4567-e89b-12d3-a456-426614174000",
                session_id="sess-001",
                capability="chat",
                requested_model="gpt-4o-mini",
                allowed_models=["gpt-4.1"],
                scopes=["capability:chat", "model:gpt-4.1"],
            ),
            "call_index": 0,
            "max_calls": 8,
        }

    monkeypatch.setattr(
        bridge_module.runtime_bridge_token_service, "consume_call", _fake_consume_call
    )

    resp = await client.post(
        "/api/v1/internal/bridge/call",
        json={"tool_name": "fetch_web_content", "arguments": {"url": "https://example.com"}},
        headers={"X-Code-Mode-Execution-Token": "tok-004"},
    )
    body = resp.json()

    assert resp.status_code == 403
    assert body["detail"]["code"] == "CODE_MODE_BRIDGE_SCOPE_DENIED"
