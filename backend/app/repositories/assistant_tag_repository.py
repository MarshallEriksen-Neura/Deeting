from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select

from app.models.assistant_tag import AssistantTag, AssistantTagLink

from .base import BaseRepository


class AssistantTagRepository(BaseRepository[AssistantTag]):
    model = AssistantTag

    async def get_by_names(self, names: list[str]) -> list[AssistantTag]:
        if not names:
            return []
        result = await self.session.execute(
            select(AssistantTag).where(AssistantTag.name.in_(names))
        )
        return list(result.scalars().all())


class AssistantTagLinkRepository(BaseRepository[AssistantTagLink]):
    model = AssistantTagLink

    async def list_for_assistant(self, assistant_id: UUID) -> list[AssistantTagLink]:
        result = await self.session.execute(
            select(AssistantTagLink).where(AssistantTagLink.assistant_id == assistant_id)
        )
        return list(result.scalars().all())

    async def delete_links(self, assistant_id: UUID, tag_ids: list[UUID]) -> None:
        if not tag_ids:
            return
        await self.session.execute(
            delete(AssistantTagLink).where(
                AssistantTagLink.assistant_id == assistant_id,
                AssistantTagLink.tag_id.in_(tag_ids),
            )
        )
        await self.session.commit()

    async def add_links(self, assistant_id: UUID, tag_ids: list[UUID]) -> None:
        if not tag_ids:
            return
        for tag_id in tag_ids:
            self.session.add(
                AssistantTagLink(assistant_id=assistant_id, tag_id=tag_id)
            )
        await self.session.commit()

    async def list_tag_names_for_assistants(self, assistant_ids: list[UUID]) -> dict[UUID, list[str]]:
        if not assistant_ids:
            return {}
        result = await self.session.execute(
            select(AssistantTagLink.assistant_id, AssistantTag.name)
            .join(AssistantTag, AssistantTag.id == AssistantTagLink.tag_id)
            .where(AssistantTagLink.assistant_id.in_(assistant_ids))
        )
        mapping: dict[UUID, list[str]] = {}
        for assistant_id, name in result.all():
            mapping.setdefault(assistant_id, []).append(name)
        return mapping
