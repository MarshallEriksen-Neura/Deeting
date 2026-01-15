from __future__ import annotations

import uuid

from sqlalchemy import (
    UUID as SA_UUID,
    Float,
    ForeignKey,
    Index,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AssistantRating(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    用户对助手的评分
    """

    __tablename__ = "assistant_rating"
    __table_args__ = (
        UniqueConstraint("user_id", "assistant_id", name="uq_assistant_rating_user"),
        Index("ix_assistant_rating_user", "user_id"),
        Index("ix_assistant_rating_assistant", "assistant_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="评分用户 ID",
    )
    assistant_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("assistant.id", ondelete="CASCADE"),
        nullable=False,
        comment="助手 ID",
    )
    rating: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="评分（1-5）",
    )

    def __repr__(self) -> str:
        return f"<AssistantRating(user={self.user_id}, assistant={self.assistant_id}, rating={self.rating})>"
