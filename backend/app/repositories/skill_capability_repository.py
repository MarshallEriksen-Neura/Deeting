from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.skill_capability import SkillCapability
from app.repositories.base import BaseRepository


class SkillCapabilityRepository(BaseRepository[SkillCapability]):
    model = SkillCapability

    def __init__(self, session: AsyncSession):
        super().__init__(session, SkillCapability)

    async def replace_all(self, skill_id: str, values: list[str]) -> None:
        await self.session.execute(
            delete(SkillCapability).where(SkillCapability.skill_id == skill_id)
        )
        if values:
            self.session.add_all(
                [SkillCapability(skill_id=skill_id, value=value) for value in values]
            )
        await self.session.commit()

    async def list_values(self, skill_id: str) -> list[str]:
        result = await self.session.execute(
            select(SkillCapability.value).where(SkillCapability.skill_id == skill_id)
        )
        return list(result.scalars().all())


__all__ = ["SkillCapabilityRepository"]
