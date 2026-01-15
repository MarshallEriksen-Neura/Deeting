from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .provider_preset import JSONBCompat


class NotificationType(str, enum.Enum):
    SYSTEM = "system"
    ALERT = "alert"
    BILLING = "billing"
    AUDIT = "audit"
    SECURITY = "security"
    MAINTENANCE = "maintenance"
    OTHER = "other"


class NotificationLevel(str, enum.Enum):
    INFO = "info"
    WARN = "warn"
    ERROR = "error"
    CRITICAL = "critical"


class Notification(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    通知主表：存储通知内容与元信息
    """

    __tablename__ = "notification"
    __table_args__ = (
        UniqueConstraint("tenant_id", "dedupe_key", name="uq_notification_tenant_dedupe"),
        Index("ix_notification_tenant_id", "tenant_id"),
        Index("ix_notification_type", "type"),
        Index("ix_notification_level", "level"),
        Index("ix_notification_source", "source"),
        Index("ix_notification_is_active", "is_active"),
        Index(
            "idx_notification_created_at",
            "created_at",
            **(
                {"postgresql_using": "brin"}
                if settings.DATABASE_URL.startswith("postgresql")
                else {}
            ),
        ),
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="租户 ID（为空表示全局）",
    )
    type: Mapped[NotificationType] = mapped_column(
        String(40),
        nullable=False,
        default=NotificationType.SYSTEM,
        server_default=NotificationType.SYSTEM.value,
        comment="通知类型",
    )
    level: Mapped[NotificationLevel] = mapped_column(
        String(20),
        nullable=False,
        default=NotificationLevel.INFO,
        server_default=NotificationLevel.INFO.value,
        comment="通知级别",
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="标题")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="内容")
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="扩展字段（非敏感）",
    )
    source: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
        comment="来源模块/服务",
    )
    dedupe_key: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
        comment="去重键（幂等）",
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="过期时间",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
        comment="是否有效",
    )

    def __repr__(self) -> str:
        return f"<Notification(id={self.id}, type={self.type}, level={self.level})>"


class NotificationReceipt(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    通知收件表：记录用户已读/归档/置顶等状态
    """

    __tablename__ = "notification_receipt"
    __table_args__ = (
        UniqueConstraint("notification_id", "user_id", name="uq_notification_receipt_user"),
        Index("ix_notification_receipt_notification_id", "notification_id"),
        Index("ix_notification_receipt_user_id", "user_id"),
        Index("ix_notification_receipt_tenant_id", "tenant_id"),
        Index("ix_notification_receipt_user_read", "user_id", "read_at"),
        Index("ix_notification_receipt_user_archived", "user_id", "archived_at"),
        Index(
            "idx_notification_receipt_created_at",
            "created_at",
            **(
                {"postgresql_using": "brin"}
                if settings.DATABASE_URL.startswith("postgresql")
                else {}
            ),
        ),
    )

    notification_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("notification.id", ondelete="CASCADE"),
        nullable=False,
        comment="通知 ID",
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="用户 ID",
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="租户 ID（冗余字段）",
    )
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="已读时间",
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="归档时间",
    )
    pinned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="置顶时间",
    )

    def __repr__(self) -> str:
        return f"<NotificationReceipt(id={self.id}, notification_id={self.notification_id})>"
