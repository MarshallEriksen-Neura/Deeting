from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, select

from app.utils.time_utils import Datetime
from app.models.conversation import (
    ConversationChannel,
    ConversationSession,
    ConversationStatus,
    ConversationSummary,
)
from app.repositories.base import BaseRepository


class ConversationSessionRepository(BaseRepository[ConversationSession]):
    model = ConversationSession

    def build_user_query(
        self,
        *,
        user_id: UUID,
        channel: ConversationChannel = ConversationChannel.INTERNAL,
        status: ConversationStatus | None = None,
        assistant_id: UUID | None = None,
    ):
        summary_join = and_(
            ConversationSummary.session_id == ConversationSession.id,
            ConversationSummary.version == ConversationSession.last_summary_version,
        )
        stmt = (
            select(ConversationSession, ConversationSummary)
            .outerjoin(ConversationSummary, summary_join)
            .where(ConversationSession.user_id == user_id)
            .order_by(ConversationSession.last_active_at.desc(), ConversationSession.id.desc())
        )
        if channel:
            stmt = stmt.where(ConversationSession.channel == channel)
        if status:
            stmt = stmt.where(ConversationSession.status == status)
        if assistant_id:
            stmt = stmt.where(ConversationSession.assistant_id == assistant_id)
        return stmt

    async def upsert_session(
        self,
        *,
        session_id: UUID,
        user_id: UUID | None,
        tenant_id: UUID | None,
        assistant_id: UUID | None,
        channel: ConversationChannel,
        last_active_at: datetime | None = None,
        message_count: int | None = None,
        first_message_at: datetime | None = None,
        title: str | None = None,
    ) -> ConversationSession:
        session_obj = await self.session.get(ConversationSession, session_id)
        if not session_obj:
            session_obj = ConversationSession(
                id=session_id,
                user_id=user_id,
                tenant_id=tenant_id,
                assistant_id=assistant_id,
                channel=channel,
                status=ConversationStatus.ACTIVE,
                message_count=message_count or 0,
                first_message_at=first_message_at,
                last_active_at=last_active_at or Datetime.now(),
                title=title,
            )
            self.session.add(session_obj)
        else:
            if user_id and not session_obj.user_id:
                session_obj.user_id = user_id
            if tenant_id and not session_obj.tenant_id:
                session_obj.tenant_id = tenant_id
            if assistant_id and not session_obj.assistant_id:
                session_obj.assistant_id = assistant_id
            if title:
                session_obj.title = title
            if first_message_at and not session_obj.first_message_at:
                session_obj.first_message_at = first_message_at
            if last_active_at:
                session_obj.last_active_at = last_active_at
            if message_count is not None:
                session_obj.message_count = max(session_obj.message_count or 0, message_count)
        await self.session.commit()
        await self.session.refresh(session_obj)
        return session_obj
