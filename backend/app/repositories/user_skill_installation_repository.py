from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_skill_installation import UserSkillInstallation


class UserSkillInstallationRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_by_user(
        self, user_id: uuid.UUID, *, enabled_only: bool = False
    ) -> list[UserSkillInstallation]:
        stmt = select(UserSkillInstallation).where(
            UserSkillInstallation.user_id == user_id
        )
        if enabled_only:
            stmt = stmt.where(UserSkillInstallation.is_enabled == True)
        stmt = stmt.order_by(
            UserSkillInstallation.created_at.desc(), UserSkillInstallation.id.desc()
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_user_skill(
        self, user_id: uuid.UUID, skill_id: str
    ) -> UserSkillInstallation | None:
        stmt = select(UserSkillInstallation).where(
            UserSkillInstallation.user_id == user_id,
            UserSkillInstallation.skill_id == skill_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_enabled_skill_ids(self, user_id: uuid.UUID) -> set[str]:
        stmt = select(UserSkillInstallation.skill_id).where(
            UserSkillInstallation.user_id == user_id,
            UserSkillInstallation.is_enabled == True,
        )
        result = await self.session.execute(stmt)
        return {str(row[0]) for row in result.all() if row and row[0]}

    async def create(
        self,
        *,
        user_id: uuid.UUID,
        skill_id: str,
        alias: str | None = None,
        config_json: dict | None = None,
        granted_permissions: list[str] | None = None,
        installed_revision: str | None = None,
        is_enabled: bool = True,
    ) -> UserSkillInstallation:
        installation = UserSkillInstallation(
            user_id=user_id,
            skill_id=skill_id,
            alias=alias,
            config_json=config_json or {},
            granted_permissions=granted_permissions or [],
            installed_revision=installed_revision,
            is_enabled=is_enabled,
        )
        self.session.add(installation)
        await self.session.flush()
        await self.session.refresh(installation)
        return installation

    async def delete_by_user_skill(self, user_id: uuid.UUID, skill_id: str) -> bool:
        stmt = delete(UserSkillInstallation).where(
            UserSkillInstallation.user_id == user_id,
            UserSkillInstallation.skill_id == skill_id,
        )
        result = await self.session.execute(stmt)
        return (result.rowcount or 0) > 0
