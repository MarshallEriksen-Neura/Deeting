from __future__ import annotations

import uuid
from typing import Any, Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationReceipt


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
