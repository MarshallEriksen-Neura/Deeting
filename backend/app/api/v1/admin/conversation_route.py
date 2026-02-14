from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.superuser import get_current_superuser
from app.models.conversation import ConversationStatus
from app.schemas.admin_ops import (
    ConversationAdminItem,
    ConversationAdminListResponse,
    ConversationMessageAdminListResponse,
    ConversationSummaryAdminListResponse,
)
from app.services.admin import ConversationAdminService

router = APIRouter(prefix="/admin/conversations", tags=["Admin - Conversations"])


def get_service(db: AsyncSession = Depends(get_db)) -> ConversationAdminService:
    return ConversationAdminService(db)


@router.get("", response_model=ConversationAdminListResponse)
async def list_conversations(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    user_id: UUID | None = None,
    assistant_id: UUID | None = None,
    channel: str | None = Query(default=None, pattern="^(internal|external)$"),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        pattern="^(active|closed|archived)$",
    ),
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    _=Depends(get_current_superuser),
    service: ConversationAdminService = Depends(get_service),
) -> ConversationAdminListResponse:
    return await service.list_sessions(
        skip=skip,
        limit=limit,
        user_id=user_id,
        assistant_id=assistant_id,
        channel=channel,
        status_filter=status_filter,
        start_time=start_time,
        end_time=end_time,
    )


@router.get("/{session_id}", response_model=ConversationAdminItem)
async def get_conversation(
    session_id: UUID,
    _=Depends(get_current_superuser),
    service: ConversationAdminService = Depends(get_service),
) -> ConversationAdminItem:
    return await service.get_session(session_id)


@router.get(
    "/{session_id}/messages",
    response_model=ConversationMessageAdminListResponse,
)
async def list_conversation_messages(
    session_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    include_deleted: bool = Query(True),
    _=Depends(get_current_superuser),
    service: ConversationAdminService = Depends(get_service),
) -> ConversationMessageAdminListResponse:
    return await service.list_messages(
        session_id=session_id,
        skip=skip,
        limit=limit,
        include_deleted=include_deleted,
    )


@router.get(
    "/{session_id}/summaries",
    response_model=ConversationSummaryAdminListResponse,
)
async def list_conversation_summaries(
    session_id: UUID,
    _=Depends(get_current_superuser),
    service: ConversationAdminService = Depends(get_service),
) -> ConversationSummaryAdminListResponse:
    return await service.list_summaries(session_id=session_id)


@router.post("/{session_id}/archive", response_model=ConversationAdminItem)
async def archive_conversation(
    session_id: UUID,
    _=Depends(get_current_superuser),
    service: ConversationAdminService = Depends(get_service),
) -> ConversationAdminItem:
    return await service.update_status(
        session_id=session_id,
        status_value=ConversationStatus.ARCHIVED,
    )


@router.post("/{session_id}/close", response_model=ConversationAdminItem)
async def close_conversation(
    session_id: UUID,
    _=Depends(get_current_superuser),
    service: ConversationAdminService = Depends(get_service),
) -> ConversationAdminItem:
    return await service.update_status(
        session_id=session_id,
        status_value=ConversationStatus.CLOSED,
    )
