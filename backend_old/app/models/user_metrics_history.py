from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserRoutingMetricsHistory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    Aggregated routing metrics for a single user scoped by provider/logical_model.

    This table powers the per-user overview API without mixing with system-wide metrics.
    """

    __tablename__ = "user_routing_metrics_history"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "provider_id",
            "logical_model",
            "is_stream",
            "window_start",
            name="uq_user_routing_metrics_history_bucket",
        ),
        Index(
            "ix_user_routing_metrics_history_user_window",
            "user_id",
            "window_start",
        ),
        Index(
            "ix_user_routing_metrics_history_user_provider_window",
            "user_id",
            "provider_id",
            "window_start",
        ),
    )

    user_id: Mapped[PG_UUID] = Column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True,
    )
    provider_id: Mapped[str] = Column(
        String(50),
        nullable=False,
        index=True,
    )
    logical_model: Mapped[str] = Column(
        String(100),
        nullable=False,
        index=True,
    )
    is_stream: Mapped[bool] = Column(
        Boolean,
        nullable=False,
        server_default=text("FALSE"),
    )
    window_start = Column(DateTime(timezone=True), nullable=False, index=True)
    window_duration: Mapped[int] = Column(
        Integer,
        nullable=False,
        server_default=text("60"),
    )
    total_requests: Mapped[int] = Column(Integer, nullable=False)
    success_requests: Mapped[int] = Column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    error_requests: Mapped[int] = Column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    latency_avg_ms: Mapped[float] = Column(
        Float,
        nullable=False,
        server_default=text("0"),
    )
    latency_p95_ms: Mapped[float] = Column(Float, nullable=False)
    latency_p99_ms: Mapped[float] = Column(Float, nullable=False)
    error_rate: Mapped[float] = Column(
        Float,
        nullable=False,
        server_default=text("0"),
    )


__all__ = ["UserRoutingMetricsHistory"]
