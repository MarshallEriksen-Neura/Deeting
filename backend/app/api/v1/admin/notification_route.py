"""
管理员通知发布 API 路由 (/api/v1/admin/notifications)

端点:
- POST /admin/notifications/users/{user_id} - 发布单用户通知 [权限: notification.manage]
- POST /admin/notifications/broadcast - 发布全员通知 [权限: notification.manage]
"""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import require_permissions
from app.schemas.notification import (
    NotificationPublishAllRequest,
    NotificationPublishResponse,
    NotificationPublishUserRequest,
)
from app.services.notifications import NotificationService

router = APIRouter(prefix="/admin/notifications", tags=["Admin - Notifications"])


@router.post(
    "/users/{user_id}",
    response_model=NotificationPublishResponse,
    dependencies=[Depends(require_permissions(["notification.manage"]))],
)
async def publish_to_user(
    user_id: UUID,
    request: NotificationPublishUserRequest,
    db: AsyncSession = Depends(get_db),
) -> NotificationPublishResponse:
    """发布通知给单个用户"""
    service = NotificationService(db)
    notification = await service.publish_to_user(
        user_id=user_id,
        title=request.title,
        content=request.content,
        tenant_id=request.tenant_id,
        notification_type=request.type,
        level=request.level,
        payload=request.payload,
        source=request.source,
        dedupe_key=request.dedupe_key,
        expires_at=request.expires_at,
    )
    return NotificationPublishResponse(
        notification_id=notification.id,
        scheduled=True,
        message="Notification scheduled",
    )


@router.post(
    "/broadcast",
    response_model=NotificationPublishResponse,
    dependencies=[Depends(require_permissions(["notification.manage"]))],
)
async def publish_to_all(
    request: NotificationPublishAllRequest,
    db: AsyncSession = Depends(get_db),
) -> NotificationPublishResponse:
    """发布通知给全员用户"""
    service = NotificationService(db)
    notification = await service.publish_to_all(
        title=request.title,
        content=request.content,
        tenant_id=request.tenant_id,
        notification_type=request.type,
        level=request.level,
        payload=request.payload,
        source=request.source,
        dedupe_key=request.dedupe_key,
        expires_at=request.expires_at,
        active_only=request.active_only,
    )
    return NotificationPublishResponse(
        notification_id=notification.id,
        scheduled=True,
        message="Notification scheduled for all users",
    )
