from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy import func

from app.models.assistant_install import AssistantInstall

from .base import BaseRepository


class AssistantInstallRepository(BaseRepository[AssistantInstall]):
    model = AssistantInstall

    async def get_by_user_and_assistant(
        self,
        user_id: UUID,
        assistant_id: UUID,
    ) -> AssistantInstall | None:
        result = await self.session.execute(
            select(AssistantInstall).where(
                AssistantInstall.user_id == user_id,
                AssistantInstall.assistant_id == assistant_id,
            )
        )
        return result.scalars().first()

    async def list_by_user(self, user_id: UUID) -> list[AssistantInstall]:
        result = await self.session.execute(
            select(AssistantInstall).where(AssistantInstall.user_id == user_id)
        )
        return list(result.scalars().all())

    async def list_by_user_and_assistant_ids(
        self,
        user_id: UUID,
        assistant_ids: list[UUID],
    ) -> list[AssistantInstall]:
        if not assistant_ids:
            return []
        result = await self.session.execute(
            select(AssistantInstall).where(
                AssistantInstall.user_id == user_id,
                AssistantInstall.assistant_id.in_(assistant_ids),
            )
        )
        return list(result.scalars().all())

    async def count_by_assistant(self, assistant_id: UUID) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(AssistantInstall).where(
                AssistantInstall.assistant_id == assistant_id
            )
        )
        return int(result.scalar() or 0)
