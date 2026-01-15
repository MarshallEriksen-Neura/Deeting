from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    UUID as SA_UUID,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.provider_preset import JSONBCompat


class ReviewStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    SUSPENDED = "suspended"


class ReviewTask(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    通用审核任务（可复用到助手/技能/图片等）
    """

    __tablename__ = "review_task"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", name="uq_review_task_entity"),
        Index("ix_review_task_entity_type", "entity_type"),
        Index("ix_review_task_status", "status"),
        Index("ix_review_task_entity", "entity_type", "entity_id"),
    )

    entity_type: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment="审核对象类型，如 assistant_market",
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=False,
        comment="审核对象 ID",
    )
    status: Mapped[ReviewStatus] = mapped_column(
        String(20),
        nullable=False,
        default=ReviewStatus.DRAFT,
        server_default=ReviewStatus.DRAFT.value,
        comment="审核状态: draft/pending/approved/rejected/suspended",
    )
    submitter_user_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
        comment="提交人用户 ID",
    )
    reviewer_user_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
        comment="审核人用户 ID",
    )
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="提交审核时间",
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="审核完成时间",
    )
    reason: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="审核备注/拒绝原因",
    )
    payload: Mapped[dict] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="审核上下文扩展字段",
    )

    def __repr__(self) -> str:
        return f"<ReviewTask(type={self.entity_type}, id={self.entity_id}, status={self.status})>"
