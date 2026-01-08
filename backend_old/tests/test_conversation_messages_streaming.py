from __future__ import annotations

import json
from uuid import UUID

from fastapi.testclient import TestClient

from app.jwt_auth import AuthenticatedUser, require_jwt_token
from app.models import APIKey, User


def test_create_conversation_message_streaming_sse(client: TestClient, db_session, monkeypatch):
    user = db_session.query(User).first()
    api_key = db_session.query(APIKey).first()
    assert user is not None
    assert api_key is not None

    # Override JWT auth dependency for assistant/conversation routes.
    client.app.dependency_overrides[require_jwt_token] = lambda: AuthenticatedUser(
        id=str(user.id),
        username=user.username,
        email=user.email,
        is_superuser=bool(user.is_superuser),
        is_active=True,
    )

    # Patch streaming executor to avoid real upstream calls.
    async def _fake_execute_run_stream(db, **kwargs):
        run = kwargs["run"]
        yield {"type": "run.delta", "delta": "Hello"}
        yield {"type": "run.delta", "delta": " world"}

        run.status = "succeeded"
        run.output_text = "Hello world"
        run.output_preview = "Hello world"
        db.add(run)
        db.commit()

    monkeypatch.setattr("app.services.chat_app_service.execute_run_stream", _fake_execute_run_stream)

    # Create assistant
    resp = client.post(
        "/v1/assistants",
        json={
            "project_id": str(api_key.id),
            "name": "默认助手",
            "system_prompt": "你是一个测试助手",
            "default_logical_model": "test-model",
        },
    )
    assert resp.status_code == 201
    assistant_id = resp.json()["assistant_id"]

    # Create conversation
    resp = client.post(
        "/v1/conversations",
        json={"assistant_id": assistant_id, "project_id": str(api_key.id), "title": "test"},
    )
    assert resp.status_code == 201
    conversation_id = resp.json()["conversation_id"]

    # Stream message
    payload = {"content": "hi", "streaming": True}
    with client.stream(
        "POST",
        f"/v1/conversations/{conversation_id}/messages",
        json=payload,
        headers={"Accept": "text/event-stream"},
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")

        events: list[dict] = []
        for line in response.iter_lines():
            if not line:
                continue
            line_str = line.decode("utf-8") if isinstance(line, (bytes, bytearray)) else str(line)
            if not line_str.startswith("data: "):
                continue
            data_str = line_str[len("data: ") :]
            if data_str == "[DONE]":
                continue
            events.append(json.loads(data_str))

        event_types = [e.get("type") for e in events]
        assert "message.created" in event_types
        assert "message.delta" in event_types
        assert "message.completed" in event_types

        created = next(e for e in events if e.get("type") == "message.created")
        assert UUID(created["user_message_id"])
        assert UUID(created["assistant_message_id"])

    # Verify messages are persisted and assistant text exists
    resp = client.get(f"/v1/conversations/{conversation_id}/messages")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert any(
        it.get("role") == "assistant" and (it.get("content") or {}).get("text") == "Hello world"
        for it in items
    )

