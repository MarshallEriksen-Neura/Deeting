from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.skill_registry import SkillRegistry
from app.repositories.base import BaseRepository


class SkillRegistryRepository(BaseRepository[SkillRegistry]):
    model = SkillRegistry

    def __init__(self, session: AsyncSession):
        super().__init__(session, SkillRegistry)

    async def get_by_id(self, skill_id: str) -> SkillRegistry | None:
        result = await self.session.execute(
            select(SkillRegistry).where(SkillRegistry.id == skill_id)
        )
        return result.scalars().first()


__all__ = ["SkillRegistryRepository"]
