from __future__ import annotations

import uuid

from sqlalchemy import (
    UUID as SA_UUID,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AssistantTag(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    助手标签
    """

    __tablename__ = "assistant_tag"
    __table_args__ = (
        UniqueConstraint("name", name="uq_assistant_tag_name"),
        Index("ix_assistant_tag_name", "name"),
    )

    name: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="标签名称（如 #Python）",
    )

    def __repr__(self) -> str:
        return f"<AssistantTag(name={self.name})>"


class AssistantTagLink(Base):
    """
    助手与标签关系表
    """

    __tablename__ = "assistant_tag_link"
    __table_args__ = (
        UniqueConstraint("assistant_id", "tag_id", name="uq_assistant_tag_link"),
        Index("ix_assistant_tag_link_assistant", "assistant_id"),
        Index("ix_assistant_tag_link_tag", "tag_id"),
    )

    assistant_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("assistant.id", ondelete="CASCADE"),
        primary_key=True,
        comment="助手 ID",
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("assistant_tag.id", ondelete="CASCADE"),
        primary_key=True,
        comment="标签 ID",
    )

    def __repr__(self) -> str:
        return f"<AssistantTagLink(assistant={self.assistant_id}, tag={self.tag_id})>"
