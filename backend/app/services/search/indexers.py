from __future__ import annotations

from typing import Any

from app.models.mcp_market import McpMarketTool


class MeilisearchIndexService:
    @staticmethod
    def build_mcp_tool_doc(tool: McpMarketTool) -> dict[str, Any]:
        return {
            "id": str(tool.id),
            "identifier": tool.identifier,
            "name": tool.name,
            "description": tool.description,
            "category": tool.category,
            "tags": list(tool.tags or []),
            "is_official": tool.is_official,
            "download_count": tool.download_count,
        }
