from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.core.transaction_celery import get_transaction_scheduler
from app.models.notification import Notification, NotificationLevel, NotificationType
from app.repositories.notification_repository import (
    NotificationReceiptRepository,
    NotificationRepository,
)
from app.tasks.notification import (
    publish_notification_to_all_users_task,
    publish_notification_to_user_task,
)


class NotificationService:
    """通知发布服务（创建通知并调度 Celery 投递）"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.notification_repo = NotificationRepository(session)
        self.receipt_repo = NotificationReceiptRepository(session)

    async def publish_to_user(
        self,
        user_id: uuid.UUID | str,
        *,
        title: str,
        content: str,
        tenant_id: uuid.UUID | None = None,
        notification_type: NotificationType = NotificationType.SYSTEM,
        level: NotificationLevel = NotificationLevel.INFO,
        payload: dict[str, Any] | None = None,
        source: str | None = None,
        dedupe_key: str | None = None,
        expires_at=None,
        enqueue: bool = True,
        commit: bool = True,
    ) -> Notification:
        """发布通知给单个用户"""
        user_uuid = _parse_uuid(user_id, "user_id")
        data = _build_notification_data(
            title=title,
            content=content,
            tenant_id=tenant_id,
            notification_type=notification_type,
            level=level,
            payload=payload,
            source=source,
            dedupe_key=dedupe_key,
            expires_at=expires_at,
        )
        notification = await self.notification_repo.create_notification(data, commit=False)

        if enqueue:
            scheduler = get_transaction_scheduler(self.session)
            scheduler.delay_after_commit(
                publish_notification_to_user_task,
                str(notification.id),
                str(user_uuid),
            )
        else:
            await self.receipt_repo.create_receipts(
                notification_id=notification.id,
                user_ids=[user_uuid],
                tenant_id=tenant_id,
                commit=False,
            )

        if commit:
            await self.session.commit()
            await self.session.refresh(notification)
        else:
            await self.session.flush()

        logger.info(
            "notification_publish_user_scheduled",
            extra={
                "notification_id": str(notification.id),
                "user_id": str(user_uuid),
                "enqueue": enqueue,
            },
        )
        return notification

    async def publish_to_all(
        self,
        *,
        title: str,
        content: str,
        tenant_id: uuid.UUID | None = None,
        notification_type: NotificationType = NotificationType.SYSTEM,
        level: NotificationLevel = NotificationLevel.INFO,
        payload: dict[str, Any] | None = None,
        source: str | None = None,
        dedupe_key: str | None = None,
        expires_at=None,
        active_only: bool = True,
        enqueue: bool = True,
        commit: bool = True,
    ) -> Notification:
        """发布通知给全员（默认仅激活用户）"""
        data = _build_notification_data(
            title=title,
            content=content,
            tenant_id=tenant_id,
            notification_type=notification_type,
            level=level,
            payload=payload,
            source=source,
            dedupe_key=dedupe_key,
            expires_at=expires_at,
        )
        notification = await self.notification_repo.create_notification(data, commit=False)

        if enqueue:
            scheduler = get_transaction_scheduler(self.session)
            scheduler.delay_after_commit(
                publish_notification_to_all_users_task,
                str(notification.id),
                active_only,
            )
        else:
            raise ValueError("publish_to_all requires enqueue=True to avoid blocking")

        if commit:
            await self.session.commit()
            await self.session.refresh(notification)
        else:
            await self.session.flush()

        logger.info(
            "notification_publish_all_scheduled",
            extra={
                "notification_id": str(notification.id),
                "active_only": active_only,
                "enqueue": enqueue,
            },
        )
        return notification


def _parse_uuid(value: uuid.UUID | str, field: str) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"invalid {field}: {value}") from exc


def _build_notification_data(
    *,
    title: str,
    content: str,
    tenant_id: uuid.UUID | None,
    notification_type: NotificationType,
    level: NotificationLevel,
    payload: dict[str, Any] | None,
    source: str | None,
    dedupe_key: str | None,
    expires_at,
) -> dict[str, Any]:
    return {
        "tenant_id": tenant_id,
        "type": notification_type,
        "level": level,
        "title": title,
        "content": content,
        "payload": payload or {},
        "source": source,
        "dedupe_key": dedupe_key,
        "expires_at": expires_at,
        "is_active": True,
    }
