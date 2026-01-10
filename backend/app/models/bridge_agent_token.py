"""
Bridge Agent Token 模型（仅内部网关用于云端 MCP 通道）。

功能需求：
- 记录 user+agent 维度的 token 版本，支持单活与重置。
- 由 BridgeAgentTokenService 管理签发与缓存。
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class BridgeAgentToken(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Bridge Agent token 版本记录（内网 Tunnel Gateway 身份认证）。"""

    __tablename__ = "bridge_agent_token"
    __table_args__ = (
        UniqueConstraint("user_id", "agent_id", name="uq_bridge_agent_token_user_agent"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=False,
        index=True,
        comment="所属用户 ID",
    )

    agent_id: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        index=True,
        comment="Agent 标识（客户端自定义）",
    )

    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment="当前有效版本，单活",
    )

    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="签发时间",
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="过期时间",
    )


__all__ = ["BridgeAgentToken"]
