"""
UsageRepository: 用量记录占位实现

当前仅将记录写入缓存列表，方便后续替换为真实表。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_keys import CacheKeys


class UsageRepository:
    def __init__(self, session: AsyncSession | None = None):
        self.session = session

    async def create(self, usage: dict[str, Any]) -> None:
        # 简单写入缓存队列（长度不做限制）
        items = await cache.get(CacheKeys.usage_records()) or []
        items.append(usage)
        await cache.set(CacheKeys.usage_records(), items, ttl=600)
