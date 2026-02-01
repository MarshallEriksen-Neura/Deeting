from __future__ import annotations

from app.core.cache import cache
from app.core.config import settings


class SearchCursorStore:
    def __init__(self) -> None:
        self._prefix = "search:cursor:"

    async def _cache_set(self, key: str, value: dict) -> bool:
        return await cache.set(key, value, ttl=settings.SEARCH_CURSOR_TTL_SECONDS)

    async def _cache_get(self, key: str) -> dict | None:
        return await cache.get(key)

    async def save(self, cursor: str, *, offset: int) -> None:
        await self._cache_set(f"{self._prefix}{cursor}", {"offset": offset})

    async def load(self, cursor: str) -> dict | None:
        return await self._cache_get(f"{self._prefix}{cursor}")
