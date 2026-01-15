from __future__ import annotations

import uuid

from sqlalchemy import (
    UUID as SA_UUID,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AssistantInstall(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    用户安装助手的关系表
    """

    __tablename__ = "assistant_install"
    __table_args__ = (
        UniqueConstraint("user_id", "assistant_id", name="uq_assistant_install_user"),
        Index("ix_assistant_install_user", "user_id"),
        Index("ix_assistant_install_assistant", "assistant_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="所属用户 ID",
    )
    assistant_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("assistant.id", ondelete="CASCADE"),
        nullable=False,
        comment="助手 ID",
    )
    alias: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="用户侧别名",
    )
    icon_override: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="用户侧图标覆盖",
    )
    pinned_version_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("assistant_version.id", ondelete="SET NULL"),
        nullable=True,
        comment="锁定版本 ID",
    )
    follow_latest: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
        comment="是否跟随最新版本",
    )
    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
        comment="是否启用",
    )
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="排序权重",
    )

    def __repr__(self) -> str:
        return f"<AssistantInstall(user={self.user_id}, assistant={self.assistant_id})>"
