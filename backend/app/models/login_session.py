"""
用户登录会话模型。

功能需求：
- 记录用户每次登录的设备、IP、UA 信息
- 关联 refresh token JTI，支持会话级注销
- 由 LoginSessionService 管理
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class LoginSession(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """用户登录会话记录。"""

    __tablename__ = "login_session"

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属用户 ID",
    )

    refresh_token_jti: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True,
        comment="关联的 refresh token JTI",
    )

    ip_address: Mapped[str | None] = mapped_column(
        String(45),
        nullable=True,
        comment="登录 IP 地址",
    )

    user_agent: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="原始 User-Agent 字符串",
    )

    device_type: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
        comment="设备类型: desktop / mobile / tablet",
    )

    device_name: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="设备描述: 如 Chrome on macOS",
    )

    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="最近活跃时间",
    )

    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
        comment="注销时间，NULL 表示活跃",
    )


__all__ = ["LoginSession"]
