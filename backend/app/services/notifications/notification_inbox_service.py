from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationReceipt
from app.repositories.notification_repository import NotificationReceiptRepository
from app.schemas.notification import NotificationInboxItem


class NotificationInboxService:
    """用户通知收件箱服务（查询/已读/清空）"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.receipt_repo = NotificationReceiptRepository(session)

    async def fetch_snapshot(
        self,
        user_id: uuid.UUID,
        *,
        limit: int = 50,
    ) -> tuple[list[NotificationInboxItem], int, datetime | None]:
        rows = await self.receipt_repo.list_user_notifications(
            user_id,
            limit=limit,
            order_desc=True,
        )
        items = [self._to_item(receipt, notification) for receipt, notification in rows]
        unread_count = await self.receipt_repo.count_unread(user_id)
        last_seen_at = self._max_created_at(rows)
        return items, unread_count, last_seen_at

    async def fetch_since(
        self,
        user_id: uuid.UUID,
        *,
        since: datetime | None,
        limit: int = 50,
    ) -> tuple[list[NotificationInboxItem], datetime | None]:
        if since is None:
            return [], None
        rows = await self.receipt_repo.list_user_notifications(
            user_id,
            limit=limit,
            since=since,
            order_desc=False,
        )
        items = [self._to_item(receipt, notification) for receipt, notification in rows]
        last_seen_at = self._max_created_at(rows)
        return items, last_seen_at

    async def mark_read(
        self,
        user_id: uuid.UUID,
        notification_id: uuid.UUID,
    ) -> int:
        updated = await self.receipt_repo.mark_read(user_id, notification_id)
        # 不在 Service 层直接 commit，由上层管理事务
        return updated

    async def mark_all_read(
        self,
        user_id: uuid.UUID,
    ) -> int:
        updated = await self.receipt_repo.mark_all_read(user_id)
        # 不在 Service 层直接 commit，由上层管理事务
        return updated

    async def clear_all(
        self,
        user_id: uuid.UUID,
    ) -> int:
        updated = await self.receipt_repo.archive_all(user_id)
        # 不在 Service 层直接 commit，由上层管理事务
        return updated

    async def get_unread_count(self, user_id: uuid.UUID) -> int:
        return await self.receipt_repo.count_unread(user_id)

    @staticmethod
    def _to_item(receipt: NotificationReceipt, notification: Notification) -> NotificationInboxItem:
        return NotificationInboxItem(
            id=notification.id,
            notification_id=notification.id,
            title=notification.title,
            content=notification.content,
            type=notification.type,
            level=notification.level,
            payload=notification.payload or {},
            source=notification.source,
            created_at=receipt.created_at,
            read_at=receipt.read_at,
            archived_at=receipt.archived_at,
            read=receipt.read_at is not None,
        )

    @staticmethod
    def _max_created_at(rows: list[tuple[NotificationReceipt, Notification]]) -> datetime | None:
        if not rows:
            return None
        return max(receipt.created_at for receipt, _ in rows)
