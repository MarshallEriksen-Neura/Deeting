from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Iterable

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationReceipt
from app.utils.time_utils import Datetime


class NotificationRepository:
    """通知主表仓库"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_notification(
        self,
        data: dict[str, Any],
        commit: bool = True,
    ) -> Notification:
        notification = Notification(**data)
        self.session.add(notification)
        if commit:
            await self.session.commit()
            await self.session.refresh(notification)
        else:
            await self.session.flush()
        return notification

    async def get_by_id(self, notification_id: uuid.UUID) -> Notification | None:
        return await self.session.get(Notification, notification_id)


class NotificationReceiptRepository:
    """通知收件表仓库"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_receipts(
        self,
        notification_id: uuid.UUID,
        user_ids: Iterable[uuid.UUID],
        tenant_id: uuid.UUID | None = None,
        commit: bool = True,
    ) -> list[NotificationReceipt]:
        receipts = [
            NotificationReceipt(
                notification_id=notification_id,
                user_id=user_id,
                tenant_id=tenant_id,
            )
            for user_id in user_ids
        ]
        if receipts:
            self.session.add_all(receipts)
        if commit:
            await self.session.commit()
            for receipt in receipts:
                await self.session.refresh(receipt)
        else:
            await self.session.flush()
        return receipts

    async def list_user_notifications(
        self,
        user_id: uuid.UUID,
        *,
        limit: int = 50,
        since: datetime | None = None,
        order_desc: bool = True,
    ) -> list[tuple[NotificationReceipt, Notification]]:
        now = Datetime.now()
        stmt = (
            select(NotificationReceipt, Notification)
            .join(Notification, Notification.id == NotificationReceipt.notification_id)
            .where(NotificationReceipt.user_id == user_id)
            .where(NotificationReceipt.archived_at.is_(None))
            .where(Notification.is_active.is_(True))
            .where(or_(Notification.expires_at.is_(None), Notification.expires_at > now))
        )
        if since:
            stmt = stmt.where(NotificationReceipt.created_at > since)

        order_by = NotificationReceipt.created_at.desc() if order_desc else NotificationReceipt.created_at.asc()
        stmt = stmt.order_by(order_by).limit(limit)

        result = await self.session.execute(stmt)
        return list(result.all())

    async def count_unread(
        self,
        user_id: uuid.UUID,
    ) -> int:
        now = Datetime.now()
        stmt = (
            select(func.count(NotificationReceipt.id))
            .join(Notification, Notification.id == NotificationReceipt.notification_id)
            .where(NotificationReceipt.user_id == user_id)
            .where(NotificationReceipt.read_at.is_(None))
            .where(NotificationReceipt.archived_at.is_(None))
            .where(Notification.is_active.is_(True))
            .where(or_(Notification.expires_at.is_(None), Notification.expires_at > now))
        )
        result = await self.session.execute(stmt)
        return int(result.scalar() or 0)

    async def mark_read(
        self,
        user_id: uuid.UUID,
        notification_id: uuid.UUID,
    ) -> int:
        stmt = (
            update(NotificationReceipt)
            .where(NotificationReceipt.user_id == user_id)
            .where(NotificationReceipt.notification_id == notification_id)
            .where(NotificationReceipt.read_at.is_(None))
            .values(read_at=Datetime.now())
        )
        result = await self.session.execute(stmt)
        return int(result.rowcount or 0)

    async def mark_all_read(
        self,
        user_id: uuid.UUID,
    ) -> int:
        stmt = (
            update(NotificationReceipt)
            .where(NotificationReceipt.user_id == user_id)
            .where(NotificationReceipt.read_at.is_(None))
            .values(read_at=Datetime.now())
        )
        result = await self.session.execute(stmt)
        return int(result.rowcount or 0)

    async def archive_all(
        self,
        user_id: uuid.UUID,
    ) -> int:
        stmt = (
            update(NotificationReceipt)
            .where(NotificationReceipt.user_id == user_id)
            .where(NotificationReceipt.archived_at.is_(None))
            .values(archived_at=Datetime.now())
        )
        result = await self.session.execute(stmt)
        return int(result.rowcount or 0)
