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


class _DummyConversationHistoryMessage:
    def __init__(self, role: str, content: str, turn_index: int):
        self.role = role
        self.content = content
        self.turn_index = turn_index
        self.is_truncated = False
        self.name = None
        self.meta_info = {"blocks": [{"type": "text", "content": content}]}


class _DummyConversationHistoryService:
    def __init__(self):
        self.called_with = None

    async def load_history(self, *, session_id, user_id, limit, before_turn=None):
        self.called_with = {
            "session_id": session_id,
            "user_id": user_id,
            "limit": limit,
            "before_turn": before_turn,
        }
        return {
            "messages": [
                _DummyConversationHistoryMessage("user", "hi", 8),
                _DummyConversationHistoryMessage("assistant", "hey", 9),
            ],
            "has_more": True,
            "next_cursor": 8,
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
        self.created = None

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
            "total": 1,
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

    async def create_session(self, *, user_id, tenant_id, assistant_id, title):
        session_id = UUID("2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d")
        self.created = {
            "session_id": session_id,
            "user_id": user_id,
            "tenant_id": tenant_id,
            "assistant_id": assistant_id,
            "title": title.strip() if title else None,
        }
        return _DummyConversationSession(
            session_id=session_id,
            status="active",
            title=self.created["title"],
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


@pytest.mark.asyncio
async def test_list_conversations(monkeypatch):
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
        pass


@pytest.mark.asyncio
async def test_create_conversation(monkeypatch):
    service = _DummyConversationSessionService()
    app.dependency_overrides[
        conversation_route.get_conversation_session_service
    ] = lambda: service
    payload = {
        "assistant_id": "e3189116-959f-48f4-8d49-f7300eb527dd",
        "title": "New Chat",
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/v1/internal/conversations", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["session_id"] == "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d"
        assert data["title"] == "New Chat"
        assert service.created["assistant_id"] == UUID(payload["assistant_id"])


@pytest.mark.asyncio
async def test_get_conversation_history(monkeypatch):
    service = _DummyConversationHistoryService()
    app.dependency_overrides[
        conversation_route.get_conversation_history_service
    ] = lambda: service
    session_id = "e3189116-959f-48f4-8d49-f7300eb527dd"
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            f"/api/v1/internal/conversations/{session_id}/history?cursor=10&limit=2"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"] == session_id
        assert data["has_more"] is True
        assert data["next_cursor"] == 8
        assert data["messages"][0]["turn_index"] == 8
        assert data["messages"][1]["turn_index"] == 9
        assert service.called_with["before_turn"] == 10
        assert service.called_with["limit"] == 2


@pytest.mark.asyncio
async def test_archive_conversation(monkeypatch):
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
        pass


@pytest.mark.asyncio
async def test_unarchive_conversation(monkeypatch):
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
        pass


@pytest.mark.asyncio
async def test_rename_conversation(monkeypatch):
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
        pass


@pytest.mark.asyncio
async def test_rename_conversation_empty_title(monkeypatch):
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
        pass


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
