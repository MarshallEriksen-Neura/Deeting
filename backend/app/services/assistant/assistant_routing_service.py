from __future__ import annotations

from uuid import UUID

from app.repositories.assistant_routing_repository import AssistantRoutingRepository


class AssistantRoutingService:
    def __init__(self, session):
        self.repo = AssistantRoutingRepository(session)

    async def record_trial(self, assistant_id: UUID) -> None:
        await self.repo.record_trial(assistant_id)

    async def record_feedback(self, assistant_id: UUID, event: str) -> None:
        normalized = str(event or "").strip().lower()
        if normalized in {"thumbs_up", "like", "up", "positive"}:
            await self.repo.record_feedback(assistant_id, positive=True)
        elif normalized in {"thumbs_down", "dislike", "down", "negative", "regenerate"}:
            await self.repo.record_feedback(assistant_id, positive=False)
        else:
            raise ValueError("unknown feedback event")
