"""用户通知 REST API（标记已读、全部已读、清空）"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_active_user
from app.models import User
from app.schemas.base import BaseSchema
from app.services.notifications import NotificationInboxService

router = APIRouter(prefix="/notifications", tags=["Notifications"])


class NotificationActionResponse(BaseSchema):
    success: bool = True
    unread_count: int = 0


@router.post("/{notification_id}/read", response_model=NotificationActionResponse)
async def mark_notification_read(
    notification_id: uuid.UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationActionResponse:
    """标记单条通知为已读"""
    service = NotificationInboxService(db)
    await service.mark_read(user.id, notification_id)
    await db.commit()
    unread_count = await service.get_unread_count(user.id)
    return NotificationActionResponse(unread_count=unread_count)


@router.post("/read-all", response_model=NotificationActionResponse)
async def mark_all_notifications_read(
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationActionResponse:
    """标记所有通知为已读"""
    service = NotificationInboxService(db)
    await service.mark_all_read(user.id)
    await db.commit()
    unread_count = await service.get_unread_count(user.id)
    return NotificationActionResponse(unread_count=unread_count)


@router.post("/clear", response_model=NotificationActionResponse)
async def clear_all_notifications(
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationActionResponse:
    """清空所有通知（归档）"""
    service = NotificationInboxService(db)
    await service.clear_all(user.id)
    await db.commit()
    return NotificationActionResponse(unread_count=0)
