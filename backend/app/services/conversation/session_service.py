from __future__ import annotations

from uuid import UUID

from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi_pagination.ext.sqlalchemy import paginate
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.time_utils import Datetime
from app.models.conversation import ConversationChannel, ConversationStatus
from app.repositories.conversation_session_repository import ConversationSessionRepository
from app.schemas.conversation import ConversationSessionItem


class ConversationSessionService:
    def __init__(self, session: AsyncSession):
        self.session_repo = ConversationSessionRepository(session)

    async def list_user_sessions(
        self,
        *,
        user_id: UUID,
        params: CursorParams,
        status: ConversationStatus | None = None,
        assistant_id: UUID | None = None,
    ) -> CursorPage[ConversationSessionItem]:
        stmt = self.session_repo.build_user_query(
            user_id=user_id,
            channel=ConversationChannel.INTERNAL,
            status=status,
            assistant_id=assistant_id,
        )

        async def _transform(rows):
            items: list[ConversationSessionItem] = []
            for session_obj, summary in rows:
                items.append(
                    ConversationSessionItem(
                        session_id=session_obj.id,
                        title=session_obj.title,
                        summary_text=summary.summary_text if summary else None,
                        message_count=session_obj.message_count or 0,
                        first_message_at=session_obj.first_message_at,
                        last_active_at=session_obj.last_active_at,
                    )
                )
            return items

        return await paginate(self.session_repo.session, stmt, params=params, transformer=_transform)

    async def touch_session(
        self,
        *,
        session_id: UUID,
        user_id: UUID | None,
        tenant_id: UUID | None,
        assistant_id: UUID | None,
        channel: ConversationChannel,
        message_count: int | None = None,
    ) -> None:
        await self.session_repo.upsert_session(
            session_id=session_id,
            user_id=user_id,
            tenant_id=tenant_id,
            assistant_id=assistant_id,
            channel=channel,
            last_active_at=Datetime.now(),
            message_count=message_count,
        )
