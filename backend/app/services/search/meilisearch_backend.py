from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings
from app.core.http_client import create_async_http_client
from app.meilisearch_client import meilisearch_is_configured
from app.services.search.backend import SearchBackend
from app.services.search.cursor_store import SearchCursorStore

logger = logging.getLogger(__name__)


class MeilisearchBackend(SearchBackend):
    def __init__(self, *, cursor_store: SearchCursorStore | None = None) -> None:
        if not meilisearch_is_configured():
            raise RuntimeError("meilisearch_not_configured")
        self._base_url = str(settings.MEILISEARCH_URL).rstrip("/")
        self._index_prefix = settings.MEILISEARCH_INDEX_PREFIX or "ai_gateway"
        self._timeout = settings.MEILISEARCH_TIMEOUT_SECONDS
        self._cursor_store = cursor_store or SearchCursorStore()
        self._headers = self._build_headers()

    def _build_headers(self) -> dict[str, str]:
        api_key = (settings.MEILISEARCH_API_KEY or "").strip()
        if not api_key:
            return {}
        return {
            "Authorization": f"Bearer {api_key}",
            "X-Meili-API-Key": api_key,
        }

    async def _search(
        self,
        *,
        index_name: str,
        query: str | None,
        limit: int,
        offset: int,
        filters: list[str] | None = None,
        show_ranking_score: bool = False,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "q": query or "",
            "limit": limit,
            "offset": offset,
        }
        if filters:
            payload["filter"] = " AND ".join(filters)
        if show_ranking_score:
            payload["showRankingScore"] = True

        url = f"{self._base_url}/indexes/{index_name}/search"
        try:
            async with create_async_http_client(timeout=self._timeout, headers=self._headers) as client:
                resp = await client.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            logger.error("meilisearch_request_failed", exc_info=exc)
            raise RuntimeError("meilisearch_request_failed") from exc

    def _assistants_public_index(self) -> str:
        return f"{self._index_prefix}_assistants_public"

    @staticmethod
    def _extract_assistant_id(hit: dict[str, Any]) -> str | None:
        return str(hit.get("id") or hit.get("assistant_id") or "").strip() or None

    async def _resolve_offset(self, cursor: str | None) -> int:
        if not cursor:
            return 0
        payload = await self._cursor_store.load(cursor)
        if not payload:
            return 0
        return max(int(payload.get("offset", 0)), 0)

    async def search_public_assistants(
        self,
        *,
        query: str,
        size: int,
        cursor: str | None,
        tags: list[str] | None,
    ) -> tuple[list[str], str | None]:
        offset = await self._resolve_offset(cursor)
        filters = ["visibility = \"public\"", "status = \"published\""]
        if tags:
            filters.extend([f"tags = \"{tag}\"" for tag in tags])

        data = await self._search(
            index_name=self._assistants_public_index(),
            query=query,
            limit=size + 1,
            offset=offset,
            filters=filters,
            show_ranking_score=True,
        )
        hits = list(data.get("hits") or [])
        has_more = len(hits) > size
        if has_more:
            hits = hits[:size]

        ids: list[str] = []
        for hit in hits:
            assistant_id = self._extract_assistant_id(hit)
            if assistant_id:
                ids.append(assistant_id)

        next_cursor = None
        if has_more and hits:
            last_hit = hits[-1]
            rank = float(last_hit.get("_rankingScore") or 0)
            created_at = str(last_hit.get("created_at") or "")
            assistant_id = self._extract_assistant_id(last_hit)
            if assistant_id and created_at:
                next_cursor = f"{rank:.6f}|{created_at}|{assistant_id}"
                await self._cursor_store.save(next_cursor, offset=offset + size)

        return ids, next_cursor

    async def search_market_assistants(
        self,
        *,
        query: str | None,
        size: int,
        cursor: str | None,
        tags: list[str] | None,
    ) -> tuple[list[str], str | None]:
        raise NotImplementedError

    async def search_mcp_tools(
        self,
        *,
        search: str | None,
        category: object | None,
    ) -> list[str]:
        raise NotImplementedError

    async def search_provider_presets(
        self,
        *,
        query: str | None,
        category: str | None,
    ) -> list[str]:
        raise NotImplementedError
