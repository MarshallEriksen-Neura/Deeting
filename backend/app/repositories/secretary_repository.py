from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.models.secretary import UserSecretary, SecretaryPhase

from .base import BaseRepository


class UserSecretaryRepository(BaseRepository[UserSecretary]):
    model = UserSecretary

    async def get_by_user_id(self, user_id: UUID) -> UserSecretary | None:
        result = await self.session.execute(
            select(UserSecretary).where(UserSecretary.user_id == user_id)
        )
        return result.scalars().first()


class SecretaryPhaseRepository(BaseRepository[SecretaryPhase]):
    model = SecretaryPhase

    async def get_default(self) -> SecretaryPhase | None:
        result = await self.session.execute(
            select(SecretaryPhase).order_by(SecretaryPhase.created_at.asc())
        )
        return result.scalars().first()
