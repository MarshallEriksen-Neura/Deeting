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

    async def get_by_tool_name(self, tool_name: str) -> SkillRegistry | None:
        # Search for tool_name inside manifest_json['tools']
        # This implementation works for both PostgreSQL and SQLite (in a basic way)
        # For more efficiency, we fetch active skills and filter.
        stmt = select(SkillRegistry).where(SkillRegistry.status == "active")
        result = await self.session.execute(stmt)
        skills = result.scalars().all()
        
        for skill in skills:
            manifest = skill.manifest_json or {}
            tools = manifest.get("tools", [])
            if isinstance(tools, list):
                for tool in tools:
                    if isinstance(tool, dict) and tool.get("name") == tool_name:
                        return skill
        return None


__all__ = ["SkillRegistryRepository"]
