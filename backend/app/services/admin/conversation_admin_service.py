from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import (
    ConversationMessage,
    ConversationSession,
    ConversationStatus,
    ConversationSummary,
)
from app.schemas.admin_ops import (
    ConversationAdminItem,
    ConversationAdminListResponse,
    ConversationMessageAdminItem,
    ConversationMessageAdminListResponse,
    ConversationSummaryAdminItem,
    ConversationSummaryAdminListResponse,
)


class ConversationAdminService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_sessions(
        self,
        *,
        skip: int,
        limit: int,
        user_id: UUID | None = None,
        assistant_id: UUID | None = None,
        channel: str | None = None,
        status_filter: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> ConversationAdminListResponse:
        conditions = []
        if user_id:
            conditions.append(ConversationSession.user_id == user_id)
        if assistant_id:
            conditions.append(ConversationSession.assistant_id == assistant_id)
        if channel:
            conditions.append(ConversationSession.channel == channel)
        if status_filter:
            conditions.append(ConversationSession.status == status_filter)
        if start_time:
            conditions.append(ConversationSession.last_active_at >= start_time)
        if end_time:
            conditions.append(ConversationSession.last_active_at <= end_time)

        stmt = select(ConversationSession)
        count_stmt = select(func.count()).select_from(ConversationSession)
        if conditions:
            stmt = stmt.where(*conditions)
            count_stmt = count_stmt.where(*conditions)

        stmt = stmt.order_by(
            ConversationSession.last_active_at.desc(), ConversationSession.id.desc()
        ).offset(skip).limit(limit)

        rows = (await self.db.execute(stmt)).scalars().all()
        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        return ConversationAdminListResponse(
            items=[ConversationAdminItem.model_validate(row) for row in rows],
            total=total,
            skip=skip,
            limit=limit,
        )

    async def get_session(self, session_id: UUID) -> ConversationAdminItem:
        session_obj = await self.db.get(ConversationSession, session_id)
        if not session_obj:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="conversation session not found",
            )
        return ConversationAdminItem.model_validate(session_obj)

    async def list_messages(
        self,
        *,
        session_id: UUID,
        skip: int,
        limit: int,
        include_deleted: bool,
    ) -> ConversationMessageAdminListResponse:
        session_obj = await self.db.get(ConversationSession, session_id)
        if not session_obj:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="conversation session not found",
            )

        conditions = [ConversationMessage.session_id == session_id]
        if not include_deleted:
            conditions.append(ConversationMessage.is_deleted.is_(False))

        stmt = (
            select(ConversationMessage)
            .where(*conditions)
            .order_by(ConversationMessage.turn_index.asc())
            .offset(skip)
            .limit(limit)
        )
        count_stmt = select(func.count()).select_from(ConversationMessage).where(
            *conditions
        )

        rows = (await self.db.execute(stmt)).scalars().all()
        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        return ConversationMessageAdminListResponse(
            items=[ConversationMessageAdminItem.model_validate(row) for row in rows],
            total=total,
            skip=skip,
            limit=limit,
        )

    async def list_summaries(
        self,
        *,
        session_id: UUID,
    ) -> ConversationSummaryAdminListResponse:
        session_obj = await self.db.get(ConversationSession, session_id)
        if not session_obj:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="conversation session not found",
            )

        stmt = (
            select(ConversationSummary)
            .where(ConversationSummary.session_id == session_id)
            .order_by(ConversationSummary.version.desc())
        )
        rows = (await self.db.execute(stmt)).scalars().all()

        return ConversationSummaryAdminListResponse(
            items=[ConversationSummaryAdminItem.model_validate(row) for row in rows]
        )

    async def update_status(
        self,
        *,
        session_id: UUID,
        status_value: ConversationStatus,
    ) -> ConversationAdminItem:
        session_obj = await self.db.get(ConversationSession, session_id)
        if not session_obj:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="conversation session not found",
            )

        session_obj.status = status_value
        await self.db.commit()
        await self.db.refresh(session_obj)
        return ConversationAdminItem.model_validate(session_obj)
