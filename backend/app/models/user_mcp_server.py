from __future__ import annotations

import uuid
from sqlalchemy import (
    UUID as SA_UUID,
    Boolean,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.provider_preset import JSONBCompat


class UserMcpServer(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    User Managed MCP Server (BYOP).
    Allows users to connect their own remote MCP servers via SSE.
    """
    __tablename__ = "user_mcp_server"
    __table_args__ = (
        Index("ix_user_mcp_server_user", "user_id"),
        Index("ix_user_mcp_server_enabled", "is_enabled"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="Owner of this MCP configuration",
    )

    source_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_mcp_source.id", ondelete="CASCADE"),
        nullable=True,
        comment="Optional source subscription ID",
    )

    source_key: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Server key within the source payload",
    )
    
    name: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        comment="Display name for this MCP server",
    )
    
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Optional description",
    )
    
    sse_url: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
        comment="Full URL to the MCP SSE endpoint",
    )

    server_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="sse",
        server_default="sse",
        comment="Server type: sse (remote) or stdio (draft)",
    )
    
    # Using secret_ref_id to integrate with the project's SecretManager
    secret_ref_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Reference to the API Key/Token in UpstreamSecret",
    )
    
    auth_type: Mapped[str] = mapped_column(
        String(40),
        nullable=False,
        default="bearer",
        server_default="bearer",
        comment="Authentication type: bearer, api_key, or none",
    )

    disabled_tools: Mapped[list[str]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=list,
        server_default="[]",
        comment="Tool names disabled by user",
    )

    draft_config: Mapped[dict | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="Sanitized draft config for stdio imports",
    )
    
    # Cache for tools to avoid constant fetching during chat initialization
    # Will be synced periodically or on-demand
    tools_cache: Mapped[list[dict]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=list,
        server_default="[]",
        comment="Snapshot of tool definitions fetched from this server",
    )

    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
        comment="Whether this MCP server is currently active in chat",
    )

    def __repr__(self) -> str:
        return f"<UserMcpServer(name={self.name}, user={self.user_id}, enabled={self.is_enabled})>"
