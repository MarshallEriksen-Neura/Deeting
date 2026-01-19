from uuid import UUID

import pytest
from fastapi import HTTPException, status
from httpx import ASGITransport, AsyncClient

from app.deps.auth import get_current_user
from app.core.database import get_db
from main import app
from app.api.v1.internal import conversation_route
from app.services.orchestrator.orchestrator import get_internal_orchestrator


class _DummyUser:
    id = "user-1"


class _DummyConversationService:
    def __init__(self, *args, **kwargs):
        self.deleted = None
        self.cleared = None

    async def delete_message(self, session_id: str, turn_index: int):
        self.deleted = (session_id, turn_index)
        return {"deleted": True, "turn_index": turn_index}

    async def clear_session(self, session_id: str):
        self.cleared = session_id
        return True

    async def load_window(self, session_id: str):
        return {
            "messages": [
                {"role": "user", "content": "hi", "turn_index": 1},
                {"role": "assistant", "content": "old", "turn_index": 2},
            ],
            "summary": None,
            "meta": {},
        }


class _DummyConversationSession:
    def __init__(self, session_id: str, status: str, title: str | None = None):
        self.id = session_id
        self.status = status
        self.title = title


class _DummyConversationSessionService:
    def __init__(self):
        self.called_with = None
        self.updated = None
        self.title_updated = None

    async def list_user_sessions(self, *args, **kwargs):
        self.called_with = kwargs
        return {
            "items": [
                {
                    "session_id": "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d",
                    "title": "Test Session",
                    "summary_text": "summary",
                    "message_count": 3,
                    "first_message_at": "2026-01-16T09:20:11+08:00",
                    "last_active_at": "2026-01-16T09:42:01+08:00",
                }
            ],
            "next_page": None,
            "previous_page": None,
        }

    async def update_session_status(self, *, session_id, user_id, status):
        self.updated = {"session_id": session_id, "user_id": user_id, "status": status}
        return _DummyConversationSession(session_id=session_id, status=status)

    async def update_session_title(self, *, session_id, user_id, title):
        normalized = title.strip()
        if not normalized:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="title cannot be empty",
            )
        self.title_updated = {
            "session_id": session_id,
            "user_id": user_id,
            "title": normalized,
        }
        return _DummyConversationSession(
            session_id=session_id,
            status="active",
            title=normalized,
        )


class _DummyOrchestrator:
    async def execute(self, ctx):
        ctx.set(
            "response_transform",
            "response",
            {"choices": [{"message": {"role": "assistant", "content": "new reply"}}]},
        )
        ctx.set("upstream_call", "status_code", 200)
        return type("Result", (), {"success": True})


@pytest.fixture(autouse=True)
def _override_auth(monkeypatch):
    prev_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_current_user] = lambda: _DummyUser()

    async def _fake_db():
        yield None

    app.dependency_overrides[get_db] = _fake_db
    yield
    app.dependency_overrides.clear()
    app.dependency_overrides.update(prev_overrides)


@pytest.mark.asyncio
async def test_delete_message(monkeypatch):
    monkeypatch.setattr(conversation_route, "ConversationService", _DummyConversationService)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.delete("/api/v1/internal/conversations/s1/messages/3")
        assert resp.status_code == 200
        body = resp.json()
        assert body["deleted"] is True


async def test_list_conversations(monkeypatch):
    prev_overrides = _override_auth(monkeypatch)
    service = _DummyConversationSessionService()
    app.dependency_overrides[
        conversation_route.get_conversation_session_service
    ] = lambda: service
    try:
        assistant_id = "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d"
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/internal/conversations?assistant_id={assistant_id}"
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["items"][0]["session_id"] == "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d"
            assert service.called_with["assistant_id"] == UUID(assistant_id)
            assert service.called_with["status"].value == "active"
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(prev_overrides)


@pytest.mark.asyncio
async def test_archive_conversation(monkeypatch):
    prev_overrides = _override_auth(monkeypatch)
    service = _DummyConversationSessionService()
    app.dependency_overrides[
        conversation_route.get_conversation_session_service
    ] = lambda: service
    session_id = "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d"
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(f"/api/v1/internal/conversations/{session_id}/archive")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "archived"
            assert service.updated["status"].value == "archived"
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(prev_overrides)


@pytest.mark.asyncio
async def test_unarchive_conversation(monkeypatch):
    prev_overrides = _override_auth(monkeypatch)
    service = _DummyConversationSessionService()
    app.dependency_overrides[
        conversation_route.get_conversation_session_service
    ] = lambda: service
    session_id = "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d"
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(f"/api/v1/internal/conversations/{session_id}/unarchive")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "active"
            assert service.updated["status"].value == "active"
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(prev_overrides)


@pytest.mark.asyncio
async def test_rename_conversation(monkeypatch):
    prev_overrides = _override_auth(monkeypatch)
    service = _DummyConversationSessionService()
    app.dependency_overrides[
        conversation_route.get_conversation_session_service
    ] = lambda: service
    session_id = "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d"
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.patch(
                f"/api/v1/internal/conversations/{session_id}/title",
                json={"title": "新标题"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["title"] == "新标题"
            assert service.title_updated["title"] == "新标题"
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(prev_overrides)


@pytest.mark.asyncio
async def test_rename_conversation_empty_title(monkeypatch):
    prev_overrides = _override_auth(monkeypatch)
    service = _DummyConversationSessionService()
    app.dependency_overrides[
        conversation_route.get_conversation_session_service
    ] = lambda: service
    session_id = "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d"
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.patch(
                f"/api/v1/internal/conversations/{session_id}/title",
                json={"title": "   "},
            )
            assert resp.status_code == 400
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(prev_overrides)


@pytest.mark.asyncio
async def test_clear_conversation(monkeypatch):
    monkeypatch.setattr(conversation_route, "ConversationService", _DummyConversationService)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/v1/internal/conversations/s1/clear")
        assert resp.status_code == 200
        assert resp.json()["cleared"] is True


@pytest.mark.asyncio
async def test_regenerate(monkeypatch):
    monkeypatch.setattr(conversation_route, "ConversationService", _DummyConversationService)
    app.dependency_overrides[get_internal_orchestrator] = lambda: _DummyOrchestrator()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/internal/conversations/s1/regenerate",
            json={"model": "gpt-4o-mini"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["choices"][0]["message"]["content"] == "new reply"
