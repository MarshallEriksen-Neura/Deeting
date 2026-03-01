from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.provider_preset import JSONBCompat


class NotificationChannel(str, enum.Enum):
    FEISHU = "feishu"
    DINGTALK = "dingtalk"
    TELEGRAM = "telegram"
    EMAIL = "email"
    WEBHOOK = "webhook"


class UserNotificationChannel(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    用户通知渠道配置表
    用于存储用户绑定的各种通知渠道（飞书、钉钉、Telegram、Email等）
    """

    __tablename__ = "user_notification_channel"
    __table_args__ = (
        UniqueConstraint("user_id", "channel", name="uq_user_notification_channel"),
        Index("ix_user_notification_channel_user_id", "user_id"),
        Index("ix_user_notification_channel_priority", "user_id", "priority"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="用户 ID",
    )

    channel: Mapped[NotificationChannel] = mapped_column(
        String(20),
        nullable=False,
        comment="渠道类型: feishu, dingtalk, telegram, email, webhook",
    )

    display_name: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="渠道显示名称，如「我的飞书」",
    )

    config: Mapped[dict] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        comment="渠道配置（敏感信息加密存储）",
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="是否启用",
    )

    priority: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=100,
        comment="优先级，数字越小越优先",
    )

    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最后使用时间",
    )

    def __repr__(self) -> str:
        return f"<UserNotificationChannel(user_id={self.user_id}, channel={self.channel})>"
