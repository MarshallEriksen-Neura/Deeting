from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.models.mcp_market import McpToolCategory
from app.services.search.meilisearch_backend import MeilisearchBackend


@pytest.mark.asyncio
async def test_search_mcp_tools_applies_category_filter(monkeypatch) -> None:
    monkeypatch.setattr(settings, "MEILISEARCH_URL", "http://localhost:7700")
    backend = MeilisearchBackend()

    search_mock = AsyncMock(
        return_value={
            "hits": [
                {"id": "tool-1"},
                {"tool_id": "tool-2"},
                {"id": ""},
                {"tool_id": "tool-2"},
            ]
        }
    )
    monkeypatch.setattr(backend, "_search", search_mock)

    result = await backend.search_mcp_tools(search="git", category=McpToolCategory.DEVELOPER)

    assert result == ["tool-1", "tool-2"]
    assert search_mock.await_count == 1
    kwargs = search_mock.call_args.kwargs
    assert kwargs["filters"] == ['category = "developer"']


@pytest.mark.asyncio
async def test_search_provider_presets_returns_slugs(monkeypatch) -> None:
    monkeypatch.setattr(settings, "MEILISEARCH_URL", "http://localhost:7700")
    backend = MeilisearchBackend()

    search_mock = AsyncMock(
        return_value={
            "hits": [
                {"slug": "openai"},
                {"id": "azure"},
                {"slug": "openai"},
            ]
        }
    )
    monkeypatch.setattr(backend, "_search", search_mock)

    result = await backend.search_provider_presets(query="open", category="cloud api")

    assert result == ["openai", "azure"]
    assert search_mock.await_count == 1
    kwargs = search_mock.call_args.kwargs
    assert kwargs["filters"] == ['category = "cloud api"']
