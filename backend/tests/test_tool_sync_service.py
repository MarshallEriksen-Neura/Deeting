import uuid

import pytest

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
            {"payload": {"tool_name": "tool_b", "description": "sys", "schema_json": {}}},
            {"payload": {"tool_name": "tool_a", "description": "sys", "schema_json": {}}},
        ]

    async def fake_search_user(*_args, **_kwargs):
        return [
            {"payload": {"tool_name": "tool_b", "description": "user", "schema_json": {}}},
            {"payload": {"tool_name": "tool_c", "description": "user", "schema_json": {}}},
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
    hit = {"payload": {"tool_name": "tool_x", "description": "demo", "schema_json": "{}"}}
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
