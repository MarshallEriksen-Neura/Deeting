from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import ConversationChannel
from app.repositories.conversation_message_repository import (
    ConversationMessageRepository,
)
from app.repositories.conversation_session_repository import (
    ConversationSessionRepository,
)


class ConversationHistoryService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.session_repo = ConversationSessionRepository(session)
        self.message_repo = ConversationMessageRepository(session)

    async def load_history(
        self,
        *,
        session_id: UUID,
        user_id: UUID,
        limit: int,
        before_turn: int | None = None,
    ) -> dict[str, object]:
        session_obj = await self.session_repo.get_by_user(
            session_id=session_id,
            user_id=user_id,
            channel=ConversationChannel.INTERNAL,
        )
        if not session_obj:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="conversation not found",
            )

        fetch_limit = max(int(limit), 1) + 1
        rows = await self.message_repo.list_messages(
            session_id=session_id,
            before_turn=before_turn,
            limit=fetch_limit,
        )
        has_more = len(rows) > limit
        if has_more:
            rows = rows[:limit]

        next_cursor = rows[-1].turn_index if rows and has_more else None
        messages = list(reversed(rows))
        return {
            "messages": messages,
            "has_more": has_more,
            "next_cursor": next_cursor,
        }
