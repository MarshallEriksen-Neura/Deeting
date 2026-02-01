from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings
from app.core.http_client import create_async_http_client
from app.meilisearch_client import meilisearch_is_configured

from app.models.mcp_market import McpMarketTool

logger = logging.getLogger(__name__)

class MeilisearchIndexService:
    def __init__(self) -> None:
        self._base_url = str(settings.MEILISEARCH_URL or "").rstrip("/")
        self._timeout = settings.MEILISEARCH_TIMEOUT_SECONDS
        self._headers = self._build_headers()

    def _build_headers(self) -> dict[str, str]:
        api_key = (settings.MEILISEARCH_API_KEY or "").strip()
        if not api_key:
            return {}
        return {
            "Authorization": f"Bearer {api_key}",
            "X-Meili-API-Key": api_key,
        }

    async def _request(self, method: str, path: str, *, json: Any | None = None) -> dict[str, Any] | None:
        if not meilisearch_is_configured():
            return None

        url = f"{self._base_url}{path}"
        try:
            async with create_async_http_client(timeout=self._timeout, headers=self._headers) as client:
                resp = await client.request(method, url, json=json)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            logger.error("meilisearch_request_failed", exc_info=exc)
            raise RuntimeError("meilisearch_request_failed") from exc

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

    async def upsert_documents(self, *, index: str, docs: list[dict[str, Any]]) -> None:
        if not docs:
            return
        await self._request("post", f"/indexes/{index}/documents", json=docs)

    async def delete_documents(self, *, index: str, ids: list[str]) -> None:
        if not ids:
            return
        await self._request("post", f"/indexes/{index}/documents/delete-batch", json=ids)
