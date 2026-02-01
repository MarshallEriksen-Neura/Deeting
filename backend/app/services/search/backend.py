from __future__ import annotations

from typing import Protocol


class SearchBackend(Protocol):
    async def search_public_assistants(
        self,
        *,
        query: str,
        size: int,
        cursor: str | None,
        tags: list[str] | None,
    ) -> tuple[list[str], str | None]:
        ...

    async def search_market_assistants(
        self,
        *,
        query: str | None,
        size: int,
        cursor: str | None,
        tags: list[str] | None,
    ) -> tuple[list[str], str | None]:
        ...

    async def search_mcp_tools(
        self,
        *,
        search: str | None,
        category: object | None,
    ) -> list[str]:
        ...

    async def search_provider_presets(
        self,
        *,
        query: str | None,
        category: str | None,
    ) -> list[str]:
        ...


def get_search_backend() -> SearchBackend:
    raise NotImplementedError("search backend is not configured")
