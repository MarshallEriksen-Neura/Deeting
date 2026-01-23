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
    
    sse_url: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
        comment="Full URL to the MCP SSE endpoint",
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
