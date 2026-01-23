from __future__ import annotations

from app.core.cache import cache
from app.core.cache_keys import CacheKeys


class CancelService:
    DEFAULT_TTL_SECONDS = 600

    async def mark_cancel(
        self,
        *,
        capability: str,
        user_id: str,
        request_id: str,
        ttl_seconds: int | None = None,
    ) -> None:
        key = CacheKeys.request_cancel(capability, user_id, request_id)
        await cache.set(key, True, ttl=ttl_seconds or self.DEFAULT_TTL_SECONDS)

    async def is_canceled(
        self,
        *,
        capability: str,
        user_id: str,
        request_id: str,
    ) -> bool:
        key = CacheKeys.request_cancel(capability, user_id, request_id)
        return bool(await cache.get(key))

    async def consume_cancel(
        self,
        *,
        capability: str,
        user_id: str,
        request_id: str,
    ) -> bool:
        key = CacheKeys.request_cancel(capability, user_id, request_id)
        if await cache.get(key):
            await cache.delete(key)
            return True
        return False


__all__ = ["CancelService"]
