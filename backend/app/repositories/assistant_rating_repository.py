from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select

from app.models.assistant_rating import AssistantRating

from .base import BaseRepository


class AssistantRatingRepository(BaseRepository[AssistantRating]):
    model = AssistantRating

    async def get_by_user_and_assistant(self, user_id: UUID, assistant_id: UUID) -> AssistantRating | None:
        result = await self.session.execute(
            select(AssistantRating).where(
                AssistantRating.user_id == user_id,
                AssistantRating.assistant_id == assistant_id,
            )
        )
        return result.scalars().first()

    async def aggregate_by_assistant(self, assistant_id: UUID) -> tuple[float, int]:
        result = await self.session.execute(
            select(func.coalesce(func.avg(AssistantRating.rating), 0.0), func.count())
            .where(AssistantRating.assistant_id == assistant_id)
        )
        avg, count = result.one()
        return float(avg or 0.0), int(count or 0)
