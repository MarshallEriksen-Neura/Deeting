from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserMcpSource(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    User managed MCP source subscription.
    A source represents an external MCP provider feed (JSON with mcpServers).
    """

    __tablename__ = "user_mcp_source"
    __table_args__ = (
        Index("ix_user_mcp_source_user", "user_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="Owner of this MCP source",
    )

    name: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        comment="Display name for this MCP source",
    )

    source_type: Mapped[str] = mapped_column(
        String(40),
        nullable=False,
        default="url",
        server_default="url",
        comment="Source type: modelscope, github, url, cloud, local",
    )

    path_or_url: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
        comment="Source URL or path for MCP provider feed",
    )

    trust_level: Mapped[str] = mapped_column(
        String(40),
        nullable=False,
        default="community",
        server_default="community",
        comment="Trust level: official, community, private",
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="active",
        server_default="active",
        comment="Sync status: active, inactive, syncing, error",
    )

    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Last successful sync timestamp",
    )

    is_read_only: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="Whether this source is read-only",
    )

    def __repr__(self) -> str:
        return f"<UserMcpSource(name={self.name}, user={self.user_id})>"
