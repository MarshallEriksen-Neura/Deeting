from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media_asset import MediaAsset


class MediaAssetRepository:
    """媒体资产去重仓库"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, asset_id) -> MediaAsset | None:
        return await self.session.get(MediaAsset, asset_id)

    async def get_by_hash(self, content_hash: str, size_bytes: int) -> MediaAsset | None:
        stmt = select(MediaAsset).where(
            MediaAsset.content_hash == content_hash,
            MediaAsset.size_bytes == size_bytes,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_object_key(self, object_key: str) -> MediaAsset | None:
        stmt = select(MediaAsset).where(MediaAsset.object_key == object_key)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_by_ids(self, asset_ids: list) -> list[MediaAsset]:
        if not asset_ids:
            return []
        stmt = select(MediaAsset).where(MediaAsset.id.in_(asset_ids))
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create_asset(self, data: dict[str, Any], commit: bool = True) -> MediaAsset:
        asset = MediaAsset(**data)
        self.session.add(asset)
        if commit:
            await self.session.commit()
            await self.session.refresh(asset)
        else:
            await self.session.flush()
        return asset

    async def delete_asset(self, asset: MediaAsset, commit: bool = True) -> None:
        await self.session.delete(asset)
        if commit:
            await self.session.commit()
        else:
            await self.session.flush()

    async def delete_expired(self, now, commit: bool = True) -> int:
        stmt = select(MediaAsset).where(MediaAsset.expire_at.is_not(None), MediaAsset.expire_at <= now)
        result = await self.session.execute(stmt)
        items = list(result.scalars().all())
        for asset in items:
            await self.session.delete(asset)
        if commit:
            await self.session.commit()
        else:
            await self.session.flush()
        return len(items)


__all__ = ["MediaAssetRepository"]
