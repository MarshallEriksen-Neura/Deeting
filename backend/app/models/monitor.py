from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .provider_preset import JSONBCompat


class MonitorStatus(str, enum.Enum):
    """监控任务状态。"""

    ACTIVE = "active"
    PAUSED = "paused"
    FAILED_SUSPENDED = "failed_suspended"


class MonitorTask(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    主动监控任务表。

    用户通过自然语言创建监控任务，系统定时执行研判并异步触达。
    """

    __tablename__ = "deeting_monitor_task"
    __table_args__ = (
        Index("ix_monitor_task_user_id", "user_id"),
        Index("ix_monitor_task_status", "status"),
        Index("ix_monitor_task_cron_expr", "cron_expr"),
        UniqueConstraint("user_id", "title", name="uq_monitor_task_user_title"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="归属用户 ID",
    )
    title: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="任务名称（如「伊朗局势 72H 监控」）",
    )
    objective: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="核心目标 Prompt，明确监控实体和触发条件",
    )
    cron_expr: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="0 */6 * * *",
        server_default="0 */6 * * *",
        comment="Cron 表达式（如 0 */6 * * *）",
    )
    status: Mapped[MonitorStatus] = mapped_column(
        String(30),
        nullable=False,
        default=MonitorStatus.ACTIVE,
        server_default=MonitorStatus.ACTIVE.value,
        comment="任务状态: active, paused, failed_suspended",
    )
    last_snapshot: Mapped[dict[str, Any] | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="最后快照：仅存储结构化状态",
    )
    last_executed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最后执行时间",
    )
    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
        comment="下次执行时间",
    )
    current_interval_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=360,
        server_default="360",
        comment="当前执行间隔（分钟），由 MAB 动态调整",
    )
    strategy_variants: Mapped[dict[str, Any] | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="策略变体，用于 MAB 优胜劣汰",
    )
    assistant_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("assistant.id", ondelete="SET NULL"),
        nullable=True,
        comment="关联的态势洞察智能体 ID",
    )
    model_id: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="创建任务时指定的推理模型 ID",
    )
    error_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="连续失败次数",
    )
    notify_config: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="触达配置",
    )
    allowed_tools: Mapped[list[str]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=list,
        server_default="[]",
        comment="允许调用的工具列表",
    )
    total_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="累计 Token 消耗",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
        comment="是否有效（软删除）",
    )

    def __repr__(self) -> str:
        return f"<MonitorTask(id={self.id}, title={self.title}, status={self.status})>"


class MonitorExecutionLog(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """监控任务执行日志。"""

    __tablename__ = "deeting_monitor_execution_log"
    __table_args__ = (
        Index("ix_monitor_log_task_id", "task_id"),
        Index("ix_monitor_log_created_at", "created_at"),
    )

    task_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("deeting_monitor_task.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联任务 ID",
    )
    triggered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="触发时间",
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="执行状态: success, failure, skipped",
    )
    input_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="输入数据",
    )
    output_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="输出数据",
    )
    tokens_used: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="本次消耗 Token 数",
    )
    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="错误信息",
    )

    def __repr__(self) -> str:
        return f"<MonitorExecutionLog(id={self.id}, task_id={self.task_id}, status={self.status})>"


class MonitorDeadLetter(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """监控任务死信记录。"""

    __tablename__ = "deeting_monitor_dead_letter"
    __table_args__ = (
        Index("ix_monitor_dlq_task_id", "task_id"),
        Index("ix_monitor_dlq_worker", "worker"),
        Index("ix_monitor_dlq_created_at", "created_at"),
    )

    task_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("deeting_monitor_task.id", ondelete="SET NULL"),
        nullable=True,
        comment="关联任务 ID（可能为空）",
    )
    worker: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment="失败的 worker 名称，如 reasoning_worker / notification_worker",
    )
    retry_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="发生死信时的重试次数",
    )
    payload: Mapped[dict[str, Any] | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="死信任务原始载荷",
    )
    error_message: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="错误信息摘要",
    )
    resolved: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="是否已处理",
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="处理完成时间",
    )

    def __repr__(self) -> str:
        return f"<MonitorDeadLetter(id={self.id}, task_id={self.task_id}, worker={self.worker})>"
