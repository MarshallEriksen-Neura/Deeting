from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.models.secretary import UserSecretary
from app.models.user import User

from .base import BaseRepository


class UserSecretaryRepository(BaseRepository[UserSecretary]):
    model = UserSecretary

    async def get_by_user_id(self, user_id: UUID) -> UserSecretary | None:
        result = await self.session.execute(
            select(UserSecretary).where(UserSecretary.user_id == user_id)
        )
        return result.scalars().first()

    async def get_primary_superuser_secretary(self) -> tuple[User, UserSecretary] | None:
        stmt = (
            select(User, UserSecretary)
            .join(UserSecretary, UserSecretary.user_id == User.id)
            .where(
                User.is_superuser.is_(True),
                UserSecretary.model_name.isnot(None),
            )
            .order_by(User.created_at.asc())
            .limit(1)
        )
        result = await self.session.execute(stmt)
        row = result.first()
        if not row:
            return None
        return row[0], row[1]
