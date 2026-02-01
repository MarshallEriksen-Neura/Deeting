from __future__ import annotations

from uuid import uuid4

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
