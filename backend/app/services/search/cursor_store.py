from __future__ import annotations

import logging
from typing import TypedDict

from app.core.cache import cache
from app.core.config import settings

logger = logging.getLogger(__name__)


class CursorPayload(TypedDict):
    offset: int


class SearchCursorStore:
    def __init__(self) -> None:
        self._prefix = "search:cursor:"

    async def _cache_set(self, key: str, value: CursorPayload) -> bool:
        return await cache.set(key, value, ttl=settings.SEARCH_CURSOR_TTL_SECONDS)

    async def _cache_get(self, key: str) -> CursorPayload | None:
        return await cache.get(key)

    async def save(self, cursor: str, *, offset: int) -> None:
        payload: CursorPayload = {"offset": offset}
        ok = await self._cache_set(f"{self._prefix}{cursor}", payload)
        if not ok:
            logger.warning("search_cursor_store_save_failed")

    async def load(self, cursor: str) -> CursorPayload | None:
        payload = await self._cache_get(f"{self._prefix}{cursor}")
        if not isinstance(payload, dict):
            return None
        offset = payload.get("offset")
        if not isinstance(offset, int):
            return None
        return {"offset": offset}
