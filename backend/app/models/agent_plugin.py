from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .provider_preset import JSONBCompat


class AgentPlugin(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    轻量兼容模型：用于保持旧导入路径可用。
    """

    __tablename__ = "agent_plugin"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
    )
    visibility: Mapped[str] = mapped_column(String(32), nullable=False, default="PUBLIC")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    capabilities: Mapped[list[str] | dict[str, Any] | None] = mapped_column(
        JSONBCompat,
        nullable=True,
    )
