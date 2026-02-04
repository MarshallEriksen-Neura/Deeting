from __future__ import annotations

from typing import Protocol

from app.core.config import settings
from app.meilisearch_client import meilisearch_is_configured


class SearchBackend(Protocol):
    async def search_public_assistants(
        self,
        *,
        query: str,
        size: int,
        cursor: str | None,
        tags: list[str] | None,
    ) -> tuple[list[str], str | None]: ...

    async def search_market_assistants(
        self,
        *,
        query: str | None,
        size: int,
        cursor: str | None,
        tags: list[str] | None,
    ) -> tuple[list[str], str | None]: ...

    async def search_mcp_tools(
        self,
        *,
        search: str | None,
        category: object | None,
    ) -> list[str]: ...

    async def search_provider_presets(
        self,
        *,
        query: str | None,
        category: str | None,
    ) -> list[str]: ...


_backend: SearchBackend | None = None


def get_search_backend() -> SearchBackend:
    if settings.SEARCH_BACKEND != "meilisearch":
        raise RuntimeError("search_backend_not_supported")
    if not meilisearch_is_configured():
        raise RuntimeError("meilisearch_not_configured")
    global _backend
    if _backend is None:
        from app.services.search.meilisearch_backend import MeilisearchBackend

        _backend = MeilisearchBackend()
    return _backend
