from __future__ import annotations

from uuid import uuid4
from unittest.mock import AsyncMock

import pytest

from app.models.mcp_market import McpMarketTool, McpToolCategory
from app.services.search.indexers import MeilisearchIndexService


@pytest.mark.asyncio
async def test_build_mcp_tool_doc_includes_required_fields() -> None:
    tool = McpMarketTool(
        id=uuid4(),
        identifier="mcp/github",
        name="GitHub",
        description="GitHub MCP tool",
        avatar_url=None,
        category=McpToolCategory.DEVELOPER,
        tags=["code", "repo"],
        author="Deeting Official",
        is_official=True,
        download_count=42,
        install_manifest={"runtime": "node"},
    )

    doc = MeilisearchIndexService.build_mcp_tool_doc(tool)

    assert doc["id"] == str(tool.id)
    assert doc["identifier"] == tool.identifier
    assert doc["name"] == tool.name
    assert doc["description"] == tool.description
    assert doc["category"] == tool.category
    assert doc["tags"] == tool.tags
    assert doc["is_official"] == tool.is_official
    assert doc["download_count"] == tool.download_count


@pytest.mark.asyncio
async def test_upsert_documents_calls_meili(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = MeilisearchIndexService()
    mock = AsyncMock(return_value={"taskUid": 1})
    monkeypatch.setattr(svc, "_request", mock)

    await svc.upsert_documents(index="ai_gateway_mcp_market_tools", docs=[{"id": "x"}])

    assert mock.await_count == 1
    args = mock.call_args.args
    kwargs = mock.call_args.kwargs
    assert args[0] == "post"
    assert args[1] == "/indexes/ai_gateway_mcp_market_tools/documents"
    assert kwargs["json"] == [{"id": "x"}]


@pytest.mark.asyncio
async def test_upsert_documents_skips_empty_docs(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = MeilisearchIndexService()
    mock = AsyncMock(return_value={"taskUid": 1})
    monkeypatch.setattr(svc, "_request", mock)

    await svc.upsert_documents(index="ai_gateway_mcp_market_tools", docs=[])

    assert mock.await_count == 0


@pytest.mark.asyncio
async def test_delete_documents_calls_meili(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = MeilisearchIndexService()
    mock = AsyncMock(return_value={"taskUid": 1})
    monkeypatch.setattr(svc, "_request", mock)

    await svc.delete_documents(index="ai_gateway_mcp_market_tools", ids=["x"])

    assert mock.await_count == 1
    args = mock.call_args.args
    kwargs = mock.call_args.kwargs
    assert args[0] == "post"
    assert args[1] == "/indexes/ai_gateway_mcp_market_tools/documents/delete-batch"
    assert kwargs["json"] == ["x"]


@pytest.mark.asyncio
async def test_delete_documents_skips_empty_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = MeilisearchIndexService()
    mock = AsyncMock(return_value={"taskUid": 1})
    monkeypatch.setattr(svc, "_request", mock)

    await svc.delete_documents(index="ai_gateway_mcp_market_tools", ids=[])

    assert mock.await_count == 0


@pytest.mark.asyncio
async def test_delete_all_documents_calls_meili(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = MeilisearchIndexService()
    mock = AsyncMock(return_value={"taskUid": 1})
    monkeypatch.setattr(svc, "_request", mock)

    await svc.delete_all_documents(index="ai_gateway_mcp_market_tools")

    assert mock.await_count == 1
    args = mock.call_args.args
    assert args[0] == "delete"
    assert args[1] == "/indexes/ai_gateway_mcp_market_tools/documents"
