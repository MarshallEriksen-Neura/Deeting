from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    UUID as SA_UUID,
)
from sqlalchemy import BigInteger, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.utils.time_utils import Datetime


class AssistantRoutingState(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Assistant 路由反馈状态（JIT Persona Ranking）
    """

    __tablename__ = "assistant_routing_state"

    assistant_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("assistant.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
        comment="关联的 assistant",
    )

    total_trials: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
        comment="总尝试次数（被选中次数）",
    )
    positive_feedback: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
        comment="正向反馈次数",
    )
    negative_feedback: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
        comment="负向反馈次数",
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最近一次被选中时间",
    )
    last_feedback_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最近一次反馈时间",
    )

    __table_args__ = (
        UniqueConstraint("assistant_id", name="uq_assistant_routing_state_assistant"),
    )

    def touch_used(self) -> None:
        self.total_trials += 1
        self.last_used_at = Datetime.now()

    def touch_feedback(self, positive: bool) -> None:
        if positive:
            self.positive_feedback += 1
        else:
            self.negative_feedback += 1
        self.last_feedback_at = Datetime.now()
