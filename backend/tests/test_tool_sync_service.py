import uuid

import pytest

from app.core.config import settings
from app.schemas.tool import ToolDefinition
from app.services.tools.tool_sync_service import ToolSyncService


class FakeEmbeddingService:
    async def embed_text(self, text: str):  # pragma: no cover - simple async helper
        return [0.1, 0.2]


@pytest.mark.asyncio
async def test_search_tools_prefers_user_hits(monkeypatch):
    service = ToolSyncService(embedding_service=FakeEmbeddingService())

    async def fake_search_system(*_args, **_kwargs):
        return [
            {
                "payload": {
                    "tool_name": "tool_b",
                    "description": "sys",
                    "schema_json": {},
                }
            },
            {
                "payload": {
                    "tool_name": "tool_a",
                    "description": "sys",
                    "schema_json": {},
                }
            },
        ]

    async def fake_search_user(*_args, **_kwargs):
        return [
            {
                "payload": {
                    "tool_name": "tool_b",
                    "description": "user",
                    "schema_json": {},
                }
            },
            {
                "payload": {
                    "tool_name": "tool_c",
                    "description": "user",
                    "schema_json": {},
                }
            },
        ]

    async def fake_search_skills(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )
    monkeypatch.setattr(service, "_search_system", fake_search_system)
    monkeypatch.setattr(service, "_search_user", fake_search_user)
    monkeypatch.setattr(service, "_search_skills", fake_search_skills)

    result = await service.search_tools("find tools", user_id=uuid.uuid4())
    names = [tool.name for tool in result]
    assert names == ["tool_b", "tool_c", "tool_a"]


@pytest.mark.asyncio
async def test_search_tools_empty_query_returns_empty(monkeypatch):
    service = ToolSyncService(embedding_service=FakeEmbeddingService())
    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )
    result = await service.search_tools("", user_id=uuid.uuid4())
    assert result == []


def test_hit_to_def_accepts_schema_string():
    service = ToolSyncService()
    hit = {
        "payload": {"tool_name": "tool_x", "description": "demo", "schema_json": "{}"}
    }
    tool = service._hit_to_def(hit)
    assert isinstance(tool, ToolDefinition)
    assert tool.name == "tool_x"
    assert tool.input_schema == {}


@pytest.mark.asyncio
async def test_search_tools_reranks_skill_hits(monkeypatch):
    class FakeDecisionService:
        def __init__(self, order: list[str]) -> None:
            self._order = order

        async def rank_candidates(self, _scene: str, candidates):
            return sorted(candidates, key=lambda c: self._order.index(c.arm_id))

    class FakeEmbeddingService:
        async def embed_text(self, _text: str):
            return [0.1]

    async def fake_search_skills(*_args, **_kwargs):
        return [
            {"score": 0.81, "payload": {"skill_id": "a", "description": "A"}},
            {"score": 0.80, "payload": {"skill_id": "b", "description": "B"}},
        ]

    service = ToolSyncService(
        embedding_service=FakeEmbeddingService(),
        decision_service=FakeDecisionService(order=["skill__b", "skill__a"]),
    )

    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )

    async def fake_search_system(*_args, **_kwargs):
        return []

    monkeypatch.setattr(service, "_search_system", fake_search_system)
    monkeypatch.setattr(service, "_search_skills", fake_search_skills)

    result = await service.search_tools("do something")
    assert [tool.name for tool in result] == ["skill__b", "skill__a"]


@pytest.mark.asyncio
async def test_search_tools_rerank_uses_decision_config(monkeypatch):
    captured: dict[str, object] = {}

    class FakeDecisionService:
        def __init__(self, _repo, **kwargs) -> None:
            captured.update(kwargs)

        async def rank_candidates(self, _scene: str, candidates):
            return candidates

    class DummySession:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def fake_session_factory():
        return DummySession()

    async def fake_search_skills(*_args, **_kwargs):
        return [{"score": 0.81, "payload": {"skill_id": "a", "description": "A"}}]

    service = ToolSyncService(embedding_service=FakeEmbeddingService())

    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )
    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.DecisionService",
        FakeDecisionService,
    )
    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.AsyncSessionLocal",
        fake_session_factory,
    )
    monkeypatch.setattr(service, "_search_skills", fake_search_skills)

    async def fake_search_system(*_args, **_kwargs):
        return []

    monkeypatch.setattr(service, "_search_system", fake_search_system)

    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.settings",
        settings,
    )
    monkeypatch.setattr(settings, "DECISION_STRATEGY", "ucb")
    monkeypatch.setattr(settings, "DECISION_FINAL_SCORE", "bandit_only")
    monkeypatch.setattr(settings, "DECISION_VECTOR_WEIGHT", 0.9)
    monkeypatch.setattr(settings, "DECISION_BANDIT_WEIGHT", 0.1)
    monkeypatch.setattr(settings, "DECISION_EXPLORATION_BONUS", 0.2)
    monkeypatch.setattr(settings, "DECISION_UCB_C", 0.5)
    monkeypatch.setattr(settings, "DECISION_UCB_MIN_TRIALS", 3)
    monkeypatch.setattr(settings, "DECISION_THOMPSON_PRIOR_ALPHA", 2.0)
    monkeypatch.setattr(settings, "DECISION_THOMPSON_PRIOR_BETA", 3.0)

    await service.search_tools("do something")

    assert captured["strategy"] == "ucb"
    assert captured["final_score"] == "bandit_only"
    assert captured["vector_weight"] == 0.9
    assert captured["bandit_weight"] == 0.1
    assert captured["exploration_bonus"] == 0.2
    assert captured["ucb_c"] == 0.5
    assert captured["ucb_min_trials"] == 3
    assert captured["thompson_prior_alpha"] == 2.0
    assert captured["thompson_prior_beta"] == 3.0
