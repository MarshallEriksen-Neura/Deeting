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

    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )
    monkeypatch.setattr(service, "_search_system", fake_search_system)
    monkeypatch.setattr(service, "_search_user", fake_search_user)

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
