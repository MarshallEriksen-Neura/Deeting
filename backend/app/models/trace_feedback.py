from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.provider_preset import JSONBCompat
from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from sqlalchemy import UUID as SA_UUID


class TraceFeedback(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Trace 级反馈记录（用于归因与排序优化）
    """

    __tablename__ = "trace_feedback"

    trace_id: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
        comment="请求追踪 ID",
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
        comment="反馈用户 ID",
    )
    score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="评分（-1.0 ~ 1.0）",
    )
    comment: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="可选备注",
    )
    tags: Mapped[list[str] | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="标签",
    )

    __table_args__ = (
        Index("ix_trace_feedback_trace_user", "trace_id", "user_id"),
    )


__all__ = ["TraceFeedback"]
