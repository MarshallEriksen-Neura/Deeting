from __future__ import annotations

from typing import Any

from app.repositories.skill_artifact_repository import SkillArtifactRepository
from app.repositories.skill_capability_repository import SkillCapabilityRepository
from app.repositories.skill_dependency_repository import SkillDependencyRepository
from app.repositories.skill_registry_repository import SkillRegistryRepository


STATUS_DRY_RUN_FAIL = "dry_run_fail"
STATUS_NEEDS_REVIEW = "needs_review"


class SkillRegistryService:
    def __init__(
        self,
        repo: SkillRegistryRepository,
        capability_repo: SkillCapabilityRepository,
        dependency_repo: SkillDependencyRepository,
        artifact_repo: SkillArtifactRepository,
    ):
        self.repo = repo
        self.capability_repo = capability_repo
        self.dependency_repo = dependency_repo
        self.artifact_repo = artifact_repo

    async def create(self, payload: dict[str, Any]):
        capabilities = payload.pop("capabilities", None)
        dependencies = payload.pop("dependencies", None)
        artifacts = payload.pop("artifacts", None)
        skill = await self.repo.create(payload)
        if capabilities is not None:
            await self.capability_repo.replace_all(skill.id, list(capabilities))
        if dependencies is not None:
            await self.dependency_repo.replace_all(skill.id, list(dependencies))
        if artifacts is not None:
            await self.artifact_repo.replace_all(skill.id, list(artifacts))
        return skill

    async def get(self, skill_id: str):
        return await self.repo.get_by_id(skill_id)

    async def mark_dry_run_failed(self, skill_id: str, error: str | None = None):
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")
        return await self.repo.update(skill, {"status": STATUS_DRY_RUN_FAIL})

    async def mark_needs_review(self, skill_id: str, error: str | None = None):
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")
        return await self.repo.update(skill, {"status": STATUS_NEEDS_REVIEW})
