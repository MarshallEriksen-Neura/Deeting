from __future__ import annotations

from typing import Any

from app.repositories.skill_registry_repository import SkillRegistryRepository


STATUS_DRY_RUN_FAIL = "dry_run_fail"


class SkillRegistryService:
    def __init__(self, repo: SkillRegistryRepository):
        self.repo = repo

    async def create(self, payload: dict[str, Any]):
        return await self.repo.create(payload)

    async def get(self, skill_id: str):
        return await self.repo.get_by_id(skill_id)

    async def mark_dry_run_failed(self, skill_id: str, error: str | None = None):
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")
        return await self.repo.update(skill, {"status": STATUS_DRY_RUN_FAIL})
