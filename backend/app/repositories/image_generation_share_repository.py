from __future__ import annotations

from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_generation import ImageGenerationShare


class ImageGenerationShareRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, share_id) -> ImageGenerationShare | None:
        return await self.session.get(ImageGenerationShare, share_id)

    async def get_by_task_id(self, task_id) -> ImageGenerationShare | None:
        stmt = select(ImageGenerationShare).where(ImageGenerationShare.task_id == task_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_active_by_task_id(self, task_id) -> ImageGenerationShare | None:
        stmt = select(ImageGenerationShare).where(
            ImageGenerationShare.task_id == task_id,
            ImageGenerationShare.is_active.is_(True),
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_active_by_id(self, share_id) -> ImageGenerationShare | None:
        stmt = select(ImageGenerationShare).where(
            ImageGenerationShare.id == share_id,
            ImageGenerationShare.is_active.is_(True),
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    def build_public_query(self):
        return (
            select(ImageGenerationShare)
            .where(ImageGenerationShare.is_active.is_(True))
            .order_by(ImageGenerationShare.shared_at.desc(), ImageGenerationShare.id.desc())
        )

    async def create(self, payload: dict[str, Any], commit: bool = True) -> ImageGenerationShare:
        share = ImageGenerationShare(**payload)
        self.session.add(share)
        if commit:
            await self.session.commit()
            await self.session.refresh(share)
        else:
            await self.session.flush()
        return share

    async def update_fields(self, share_id, payload: dict[str, Any], commit: bool = True) -> None:
        if not payload:
            return
        stmt = update(ImageGenerationShare).where(ImageGenerationShare.id == share_id).values(**payload)
        await self.session.execute(stmt)
        if commit:
            await self.session.commit()
        else:
            await self.session.flush()


__all__ = ["ImageGenerationShareRepository"]
