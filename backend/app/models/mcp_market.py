from __future__ import annotations

import enum
import uuid

from sqlalchemy import (
    UUID as SA_UUID,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.provider_preset import JSONBCompat


class McpToolCategory(str, enum.Enum):
    DEVELOPER = "developer"
    PRODUCTIVITY = "productivity"
    SEARCH = "search"
    DATA = "data"
    OTHER = "other"


class McpMarketTool(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "mcp_market_tool"
    __table_args__ = (
        UniqueConstraint("identifier", name="uq_mcp_market_tool_identifier"),
        Index("ix_mcp_market_tool_identifier", "identifier"),
        Index("ix_mcp_market_tool_category", "category"),
        Index("ix_mcp_market_tool_official", "is_official"),
    )

    identifier: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        comment="人类可读标识 (e.g. mcp/github)",
    )
    name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="展示名称",
    )
    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="工具简介",
    )
    avatar_url: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
        comment="展示头像 URL",
    )
    category: Mapped[McpToolCategory] = mapped_column(
        String(40),
        nullable=False,
        default=McpToolCategory.OTHER,
        server_default=McpToolCategory.OTHER.value,
        comment="分类",
    )
    tags: Mapped[list[str]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=list,
        server_default="[]",
        comment="标签",
    )
    author: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        default="Deeting Official",
        server_default="Deeting Official",
        comment="作者",
    )
    is_official: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="是否官方来源",
    )
    download_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="下载量",
    )
    install_manifest: Mapped[dict] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="安装清单 (runtime/command/args/env_config)",
    )

    def __repr__(self) -> str:
        return f"<McpMarketTool(identifier={self.identifier})>"


class UserMcpSubscription(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "user_mcp_subscription"
    __table_args__ = (
        UniqueConstraint("user_id", "market_tool_id", name="uq_user_mcp_subscription_user_tool"),
        Index("ix_user_mcp_subscription_user", "user_id"),
        Index("ix_user_mcp_subscription_tool", "market_tool_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="所属用户 ID",
    )
    market_tool_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("mcp_market_tool.id", ondelete="CASCADE"),
        nullable=False,
        comment="市场工具 ID",
    )
    alias: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="用户侧别名",
    )
    config_hash_snapshot: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="订阅时的配置快照 Hash",
    )

    def __repr__(self) -> str:
        return f"<UserMcpSubscription(user={self.user_id}, tool={self.market_tool_id})>"
