from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant_routing import AssistantRoutingState
from app.repositories.base import BaseRepository
from app.utils.time_utils import Datetime


class AssistantRoutingRepository(BaseRepository[AssistantRoutingState]):
    model = AssistantRoutingState

    def __init__(self, session: AsyncSession):
        super().__init__(session, AssistantRoutingState)

    async def get_by_assistant_id(
        self, assistant_id: UUID
    ) -> AssistantRoutingState | None:
        result = await self.session.execute(
            select(AssistantRoutingState).where(
                AssistantRoutingState.assistant_id == assistant_id
            )
        )
        return result.scalars().first()

    async def get_states_map(
        self,
        assistant_ids: Iterable[UUID],
    ) -> dict[UUID, AssistantRoutingState]:
        ids = list(assistant_ids)
        if not ids:
            return {}
        result = await self.session.execute(
            select(AssistantRoutingState).where(
                AssistantRoutingState.assistant_id.in_(ids)
            )
        )
        rows = result.scalars().all()
        return {row.assistant_id: row for row in rows}

    async def ensure_state(self, assistant_id: UUID) -> AssistantRoutingState:
        state = await self.get_by_assistant_id(assistant_id)
        if state:
            return state
        state = AssistantRoutingState(
            assistant_id=assistant_id,
            total_trials=0,
            positive_feedback=0,
            negative_feedback=0,
        )
        self.session.add(state)
        await self.session.commit()
        await self.session.refresh(state)
        return state

    async def record_trial(self, assistant_id: UUID) -> AssistantRoutingState:
        state = await self.ensure_state(assistant_id)
        state.total_trials += 1
        state.last_used_at = Datetime.now()
        await self.session.commit()
        await self.session.refresh(state)
        return state

    async def record_feedback(
        self,
        assistant_id: UUID,
        positive: bool,
    ) -> AssistantRoutingState:
        state = await self.ensure_state(assistant_id)
        if positive:
            state.positive_feedback += 1
        else:
            state.negative_feedback += 1
        state.last_feedback_at = Datetime.now()
        await self.session.commit()
        await self.session.refresh(state)
        return state
