from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.models.trace_feedback import TraceFeedback

from .base import BaseRepository


class TraceFeedbackRepository(BaseRepository[TraceFeedback]):
    model = TraceFeedback

    async def get_by_id(self, feedback_id: str) -> TraceFeedback | None:
        try:
            feedback_uuid = UUID(str(feedback_id))
        except ValueError:
            return None
        result = await self.session.execute(
            select(TraceFeedback).where(TraceFeedback.id == feedback_uuid)
        )
        return result.scalars().first()


__all__ = ["TraceFeedbackRepository"]
