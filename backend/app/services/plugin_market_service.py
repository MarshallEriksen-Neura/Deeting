from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery_app import celery_app
from app.models.skill_registry import SkillRegistry
from app.models.user_skill_installation import UserSkillInstallation
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.repositories.user_skill_installation_repository import (
    UserSkillInstallationRepository,
)
from app.utils.security import is_safe_upstream_url

logger = logging.getLogger(__name__)


class PluginMarketService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.skill_repo = SkillRegistryRepository(session)
        self.install_repo = UserSkillInstallationRepository(session)

    async def list_market_skills(
        self, *, user_id: uuid.UUID, q: str | None = None, limit: int = 50
    ) -> list[tuple[SkillRegistry, bool]]:
        stmt = select(SkillRegistry).where(
            SkillRegistry.status == "active",
        )
        keyword = (q or "").strip()
        if keyword:
            like = f"%{keyword}%"
            stmt = stmt.where(
                or_(
                    SkillRegistry.id.ilike(like),
                    SkillRegistry.name.ilike(like),
                    SkillRegistry.description.ilike(like),
                )
            )
        stmt = stmt.order_by(SkillRegistry.updated_at.desc(), SkillRegistry.id.asc())
        stmt = stmt.limit(max(1, min(limit, 100)))
        result = await self.session.execute(stmt)
        skills = list(result.scalars().all())

        installed_ids = await self.install_repo.list_enabled_skill_ids(user_id)
        return [(skill, skill.id in installed_ids) for skill in skills]

    async def list_installations(self, *, user_id: uuid.UUID) -> list[UserSkillInstallation]:
        return await self.install_repo.list_by_user(user_id, enabled_only=False)

    async def submit_repo(
        self,
        *,
        user_id: uuid.UUID,
        repo_url: str,
        revision: str = "main",
        skill_id: str | None = None,
        runtime_hint: str | None = None,
    ) -> str:
        if not is_safe_upstream_url(repo_url):
            raise HTTPException(status_code=400, detail="unsafe repo_url")
        task = celery_app.send_task(
            "skill_registry.ingest_repo",
            args=[repo_url, revision, skill_id, runtime_hint, str(user_id)],
        )
        return str(task.id)

    async def install_skill(
        self,
        *,
        user_id: uuid.UUID,
        skill_id: str,
        alias: str | None = None,
        config_json: dict | None = None,
    ) -> tuple[UserSkillInstallation, bool]:
        skill = await self.skill_repo.get_by_id(skill_id)
        if not skill:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="plugin not found"
            )
        if skill.type == "BUILTIN":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="builtin skill cannot be installed via plugin market",
            )
        if skill.status != "active":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="plugin is not active",
            )

        manifest = skill.manifest_json if isinstance(skill.manifest_json, dict) else {}
        permissions = manifest.get("permissions")
        if not isinstance(permissions, list):
            permissions = []
        permission_list = [str(item) for item in permissions if item is not None]
        existing = await self.install_repo.get_by_user_skill(user_id, skill_id)
        if existing:
            if alias is not None:
                existing.alias = alias
            if config_json is not None:
                existing.config_json = config_json
            if permission_list:
                existing.granted_permissions = permission_list
            existing.installed_revision = skill.source_revision
            existing.is_enabled = True
            await self.session.flush()
            await self.session.refresh(existing)
            return existing, False

        installation = await self.install_repo.create(
            user_id=user_id,
            skill_id=skill_id,
            alias=alias,
            config_json=config_json or {},
            granted_permissions=permission_list,
            installed_revision=skill.source_revision,
            is_enabled=True,
        )
        return installation, True

    async def uninstall_skill(self, *, user_id: uuid.UUID, skill_id: str) -> bool:
        deleted = await self.install_repo.delete_by_user_skill(user_id, skill_id)

        try:
            from app.services.tools.tool_sync_service import tool_sync_service

            await tool_sync_service.remove_user_skill_embeddings(user_id, skill_id)
        except Exception:
            logger.warning(
                "failed to cleanup skill embeddings user=%s skill=%s",
                user_id,
                skill_id,
                exc_info=True,
            )

        return deleted
