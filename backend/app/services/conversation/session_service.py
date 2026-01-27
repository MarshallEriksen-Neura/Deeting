from __future__ import annotations

import uuid
from uuid import UUID

from fastapi import HTTPException, status

from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi_pagination.ext.sqlalchemy import paginate
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.time_utils import Datetime
from app.models.conversation import ConversationChannel, ConversationSession, ConversationStatus
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

    async def create_session(
        self,
        *,
        user_id: UUID | None,
        tenant_id: UUID | None,
        assistant_id: UUID | None,
        title: str | None = None,
    ) -> ConversationSession:
        normalized_title = title.strip() if title else None
        session_id = uuid.uuid4()
        return await self.session_repo.upsert_session(
            session_id=session_id,
            user_id=user_id,
            tenant_id=tenant_id,
            assistant_id=assistant_id,
            channel=ConversationChannel.INTERNAL,
            last_active_at=Datetime.now(),
            message_count=0,
            first_message_at=None,
            title=normalized_title,
        )

    async def update_session_status(
        self,
        *,
        session_id: UUID,
        user_id: UUID,
        status: ConversationStatus,
    ) -> ConversationSession:
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
        if session_obj.status == status:
            return session_obj
        return await self.session_repo.update(session_obj, {"status": status})

    async def update_session_title(
        self,
        *,
        session_id: UUID,
        user_id: UUID,
        title: str,
    ) -> ConversationSession:
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
        new_title = title.strip()
        if not new_title:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="title cannot be empty",
            )
        if session_obj.title == new_title:
            return session_obj
        return await self.session_repo.update(session_obj, {"title": new_title})

    async def reserve_turn_indexes(
        self,
        *,
        session_id: UUID,
        user_id: UUID | None,
        tenant_id: UUID | None,
        assistant_id: UUID | None,
        channel: ConversationChannel,
        count: int,
    ) -> list[int]:
        return await self.session_repo.reserve_turn_indexes(
            session_id=session_id,
            user_id=user_id,
            tenant_id=tenant_id,
            assistant_id=assistant_id,
            channel=channel,
            count=count,
        )
