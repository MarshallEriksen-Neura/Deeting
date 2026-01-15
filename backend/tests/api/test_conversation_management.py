import pytest
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
        assert body["turn_index"] == 3


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
