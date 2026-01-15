from __future__ import annotations

import uuid
from itertools import islice
from typing import Iterable

import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.celery_app import celery_app
from app.core.db_sync import get_sync_db
from app.core.logging import logger
from app.models.notification import Notification, NotificationReceipt
from app.models.user import User


DEFAULT_BATCH_SIZE = 500


@celery_app.task(name="app.tasks.notification.publish_to_user")
def publish_notification_to_user_task(notification_id: str, user_id: str) -> str:
    """投递单用户通知（幂等）"""
    notif_uuid = _parse_uuid(notification_id, "notification_id")
    user_uuid = _parse_uuid(user_id, "user_id")
    if not notif_uuid or not user_uuid:
        return "Skipped: invalid ids"

    db: Session = next(get_sync_db())
    try:
        notification = db.get(Notification, notif_uuid)
        if not notification:
            return f"Skipped: notification not found {notification_id}"

        user = db.get(User, user_uuid)
        if not user:
            return f"Skipped: user not found {user_id}"

        inserted = _insert_receipts(
            db,
            _build_receipts(notification, [user_uuid]),
        )
        db.commit()
        return f"Inserted receipts: {inserted}"
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("notification_publish_user_failed err=%s", exc)
        raise
    finally:
        db.close()


@celery_app.task(name="app.tasks.notification.publish_to_all_users")
def publish_notification_to_all_users_task(
    notification_id: str,
    active_only: bool = True,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> str:
    """投递全员通知（默认仅激活用户）"""
    notif_uuid = _parse_uuid(notification_id, "notification_id")
    if not notif_uuid:
        return "Skipped: invalid notification_id"

    db: Session = next(get_sync_db())
    try:
        notification = db.get(Notification, notif_uuid)
        if not notification:
            return f"Skipped: notification not found {notification_id}"

        stmt = sa.select(User.id)
        if active_only:
            stmt = stmt.where(User.is_active.is_(True))

        result = db.execute(stmt)
        user_iter = result.scalars()

        total_inserted = 0
        for batch in _chunked(user_iter, batch_size):
            if not batch:
                continue
            inserted = _insert_receipts(db, _build_receipts(notification, batch))
            db.commit()
            total_inserted += inserted

        return f"Inserted receipts: {total_inserted}"
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("notification_publish_all_failed err=%s", exc)
        raise
    finally:
        db.close()


def _parse_uuid(value: str, field: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except Exception:  # noqa: BLE001
        logger.warning("notification_invalid_uuid field=%s value=%s", field, value)
        return None


def _chunked(items: Iterable[uuid.UUID], size: int) -> Iterable[list[uuid.UUID]]:
    iterator = iter(items)
    while True:
        batch = list(islice(iterator, size))
        if not batch:
            break
        yield batch


def _build_receipts(
    notification: Notification,
    user_ids: Iterable[uuid.UUID],
) -> list[dict[str, object]]:
    return [
        {
            "id": uuid.uuid4(),
            "notification_id": notification.id,
            "user_id": user_id,
            "tenant_id": notification.tenant_id,
        }
        for user_id in user_ids
    ]


def _insert_receipts(db: Session, payloads: list[dict[str, object]]) -> int:
    if not payloads:
        return 0

    dialect = db.bind.dialect.name if db.bind else "postgresql"
    if dialect == "postgresql":
        stmt = pg_insert(NotificationReceipt).values(payloads).on_conflict_do_nothing(
            constraint="uq_notification_receipt_user",
        )
    elif dialect == "sqlite":
        stmt = sa.insert(NotificationReceipt).values(payloads).prefix_with("OR IGNORE")
    else:
        stmt = sa.insert(NotificationReceipt).values(payloads)

    result = db.execute(stmt)
    return int(result.rowcount or 0)
