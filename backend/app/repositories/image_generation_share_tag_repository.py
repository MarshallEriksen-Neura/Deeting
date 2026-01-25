from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select

from app.models.assistant_tag import AssistantTag
from app.models.image_generation import ImageGenerationShareTagLink
from app.repositories.base import BaseRepository


class ImageGenerationShareTagLinkRepository(BaseRepository[ImageGenerationShareTagLink]):
    model = ImageGenerationShareTagLink

    async def list_for_share(self, share_id: UUID) -> list[ImageGenerationShareTagLink]:
        result = await self.session.execute(
            select(ImageGenerationShareTagLink).where(
                ImageGenerationShareTagLink.share_id == share_id
            )
        )
        return list(result.scalars().all())

    async def delete_links(self, share_id: UUID, tag_ids: list[UUID]) -> None:
        if not tag_ids:
            return
        await self.session.execute(
            delete(ImageGenerationShareTagLink).where(
                ImageGenerationShareTagLink.share_id == share_id,
                ImageGenerationShareTagLink.tag_id.in_(tag_ids),
            )
        )
        await self.session.commit()

    async def add_links(self, share_id: UUID, tag_ids: list[UUID]) -> None:
        if not tag_ids:
            return
        for tag_id in tag_ids:
            self.session.add(
                ImageGenerationShareTagLink(share_id=share_id, tag_id=tag_id)
            )
        await self.session.commit()

    async def list_tag_names_for_shares(
        self, share_ids: list[UUID]
    ) -> dict[UUID, list[str]]:
        if not share_ids:
            return {}
        result = await self.session.execute(
            select(ImageGenerationShareTagLink.share_id, AssistantTag.name)
            .join(AssistantTag, AssistantTag.id == ImageGenerationShareTagLink.tag_id)
            .where(ImageGenerationShareTagLink.share_id.in_(share_ids))
        )
        mapping: dict[UUID, list[str]] = {}
        for share_id, name in result.all():
            mapping.setdefault(share_id, []).append(name)
        return mapping


__all__ = ["ImageGenerationShareTagLinkRepository"]
