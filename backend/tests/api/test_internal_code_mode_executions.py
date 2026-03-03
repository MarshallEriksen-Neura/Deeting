from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

import app.api.v1.internal.code_mode_routes as code_mode_module
from app.models.code_mode_execution import CodeModeExecution
from app.repositories.code_mode_execution_repository import CodeModeExecutionRepository


@pytest.mark.asyncio
async def test_get_code_mode_execution_detail(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
):
    user_id = uuid.UUID(test_user["id"])
    execution = CodeModeExecution(
        user_id=user_id,
        session_id="sess-001",
        execution_id="exec-001",
        trace_id="trace-001",
        language="python",
        code="print('hello')",
        status="success",
        format_version="code_mode.v1",
        runtime_protocol_version="v1",
        runtime_context={"execution_id": "exec-001", "session_id": "sess-001"},
        tool_plan_results={"request": []},
        runtime_tool_calls={},
        render_blocks={},
        duration_ms=120,
        request_meta={"code_chars": 13, "tool_plan_steps": 0},
    )
    async with AsyncSessionLocal() as session:
        session.add(execution)
        await session.commit()

    resp = await client.get(
        f"/api/v1/internal/code-mode/executions/{execution.id}",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["id"] == str(execution.id)
    assert body["execution_id"] == "exec-001"
    assert body["status"] == "success"


@pytest.mark.asyncio
async def test_replay_code_mode_execution_uses_stored_tool_plan(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
    monkeypatch,
):
    user_id = uuid.UUID(test_user["id"])
    execution = CodeModeExecution(
        user_id=user_id,
        session_id="sess-replay",
        execution_id="exec-replay-001",
        trace_id="trace-replay-001",
        language="python",
        code="print('replay')",
        status="failed",
        format_version="code_mode.v1",
        runtime_protocol_version="v1",
        runtime_context={
            "identity": {"tenant_id": None, "api_key_id": None},
            "request": {"capability": "chat", "requested_model": "gpt-4.1"},
            "permissions": {"scopes": ["capability:chat"], "allowed_models": ["gpt-4.1"]},
        },
        tool_plan_results={
            "request": [
                {"tool_name": "fetch_web_content", "arguments": {"url": "https://example.com"}}
            ]
        },
        runtime_tool_calls={},
        render_blocks={},
        error="sandbox failed",
        error_code="CODE_MODE_SANDBOX_FAILED",
        duration_ms=300,
        request_meta={"code_chars": 15, "tool_plan_steps": 1},
    )
    async with AsyncSessionLocal() as session:
        session.add(execution)
        await session.commit()

    captured = {}

    async def _fake_execute(
        self,
        code,
        session_id=None,
        language="python",
        execution_timeout=30,
        dry_run=False,
        tool_plan=None,
        __context__=None,
    ):
        captured["code"] = code
        captured["session_id"] = session_id
        captured["language"] = language
        captured["execution_timeout"] = execution_timeout
        captured["tool_plan"] = tool_plan
        return {
            "status": "success",
            "session_id": session_id,
            "runtime": {"execution_id": "exec-new-001"},
        }

    monkeypatch.setattr(
        code_mode_module.DeetingCoreSdkPlugin,
        "handle_execute_code_plan",
        _fake_execute,
    )

    resp = await client.post(
        f"/api/v1/internal/code-mode/executions/{execution.execution_id}/replay",
        json={},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["source_execution_id"] == execution.execution_id
    assert body["result"]["status"] == "success"
    assert captured["code"] == "print('replay')"
    assert captured["session_id"] == "sess-replay"
    assert captured["tool_plan"] == [
        {"tool_name": "fetch_web_content", "arguments": {"url": "https://example.com"}}
    ]


@pytest.mark.asyncio
async def test_sync_code_mode_executions_creates_record_for_current_user(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
):
    resp = await client.post(
        "/api/v1/internal/code-mode/executions/sync",
        json={
            "executions": [
                {
                    "execution_id": "desktop-sync-001",
                    "session_id": "sess-sync-001",
                    "language": "python",
                    "status": "success",
                    "code": "print('sync')",
                    "runtime_context": {"code": "print('sync')"},
                    "tool_plan_results": {"request": []},
                    "runtime_tool_calls": {"calls": []},
                    "render_blocks": {"count": 0},
                    "duration_ms": 88,
                    "request_meta": {"code_chars": 13},
                }
            ]
        },
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["summary"] == {"synced": 1, "exists": 0, "failed": 0}
    assert body["results"][0]["status"] == "synced"

    async with AsyncSessionLocal() as session:
        repo = CodeModeExecutionRepository(session)
        saved = await repo.get_by_execution_id(
            user_id=uuid.UUID(test_user["id"]),
            execution_id="desktop-sync-001",
        )
    assert saved is not None
    assert saved.session_id == "sess-sync-001"
    assert saved.code == "print('sync')"


@pytest.mark.asyncio
async def test_sync_code_mode_executions_returns_exists_and_failed(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
):
    user_id = uuid.UUID(test_user["id"])
    execution = CodeModeExecution(
        user_id=user_id,
        session_id="sess-exists",
        execution_id="desktop-sync-exists",
        trace_id=None,
        language="python",
        code="print('exists')",
        status="success",
        format_version="code_mode.v1",
        runtime_protocol_version="v1",
        runtime_context={"code": "print('exists')"},
        tool_plan_results={},
        runtime_tool_calls={},
        render_blocks={},
        duration_ms=12,
        request_meta={},
    )
    async with AsyncSessionLocal() as session:
        session.add(execution)
        await session.commit()

    resp = await client.post(
        "/api/v1/internal/code-mode/executions/sync",
        json={
            "executions": [
                {
                    "execution_id": "desktop-sync-exists",
                    "session_id": "sess-exists",
                    "language": "python",
                    "status": "success",
                    "runtime_context": {"code": "print('exists')"},
                },
                {
                    "execution_id": "desktop-sync-invalid",
                    "session_id": "sess-invalid",
                    "language": "python",
                    "status": "failed",
                    "runtime_context": {},
                },
            ]
        },
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["summary"] == {"synced": 0, "exists": 1, "failed": 1}
    assert body["results"][0]["status"] == "exists"
    assert body["results"][1]["status"] == "failed"
