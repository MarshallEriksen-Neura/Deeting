from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any

from sqlalchemy import (
    String,
    Text,
    Boolean,
    DateTime,
    Integer,
    ForeignKey,
    Index,
    Float,
    SmallInteger
)
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.provider_preset import JSONBCompat

class SpecPlan(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    SpecPlan (施工蓝图表)
    存储 Master Agent 生成的 DAG 计划及全局执行状态。
    """
    __tablename__ = "spec_plan"
    __table_args__ = (
        Index("ix_spec_plan_user", "user_id"),
        Index("ix_spec_plan_status", "status"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="任务发起人",
    )

    project_name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="任务/项目名称",
    )

    manifest_data: Mapped[Dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        comment="完整的 DAG 蓝图结构 (Nodes, Edges, Rules)",
    )

    current_context: Mapped[Dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="全局变量池 (Context Snapshot)",
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="DRAFT",
        server_default="'DRAFT'",
        comment="执行状态: DRAFT, RUNNING, PAUSED, COMPLETED, FAILED",
    )

    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
        comment="蓝图版本号 (Re-plan 时递增)",
    )

    priority: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=0,
        server_default="0",
        comment="调度优先级 (越大越高)",
    )

    execution_config: Mapped[Dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="执行策略 (max_retries, timeout, cache_policy等)",
    )

    # Relationship
    logs: Mapped[List["SpecExecutionLog"]] = relationship(
        "SpecExecutionLog", back_populates="plan", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<SpecPlan(project={self.project_name}, status={self.status}, v={self.version})>"


class SpecExecutionLog(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    SpecExecutionLog (施工日志表)
    记录每个 Node 的执行快照、结果与状态。
    """
    __tablename__ = "spec_execution_log"
    __table_args__ = (
        Index("ix_spec_log_plan_node", "plan_id", "node_id"),
        Index("ix_spec_log_status", "status"),
    )

    plan_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("spec_plan.id", ondelete="CASCADE"),
        nullable=False,
        comment="所属 Plan ID",
    )

    node_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="DAG 中的节点 ID (e.g. T1_Search)",
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="PENDING",
        server_default="'PENDING'",
        comment="节点状态: PENDING, RUNNING, SUCCESS, FAILED, SKIPPED, WAITING_APPROVAL",
    )

    input_snapshot: Mapped[Dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="执行时的入参快照 (Resolved Args)",
    )

    raw_response: Mapped[Any | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="Worker/Tool 的原始返回 (用于 Debug/人工修复)",
    )

    output_data: Mapped[Dict[str, Any] | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="清洗后的结构化结果 (供下游消费)",
    )

    worker_info: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="执行者标识 (e.g. GenericWorker/Kimi-K2)",
    )

    worker_snapshot: Mapped[Dict[str, Any] | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="执行时的 Prompt/Config 备份",
    )

    retry_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="重试次数",
    )

    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="错误信息",
    )

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="开始执行时间",
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="完成/失败时间",
    )

    # Relationships
    plan: Mapped["SpecPlan"] = relationship("SpecPlan", back_populates="logs")
    sessions: Mapped[List["SpecWorkerSession"]] = relationship(
        "SpecWorkerSession", back_populates="log", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<SpecLog(node={self.node_id}, status={self.status})>"


class SpecWorkerSession(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    SpecWorkerSession (员工执行会话/思维链路表)
    记录 Sub-Agent 在执行某个 Node 时的内部思维过程 (CoT)。
    """
    __tablename__ = "spec_worker_session"
    __table_args__ = (
        Index("ix_spec_session_log", "log_id"),
    )

    log_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("spec_execution_log.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联的执行日志节点",
    )

    internal_messages: Mapped[List[Dict[str, Any]]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=list,
        server_default="[]",
        comment="内部对话历史 (Role: system/user/assistant/tool)",
    )

    thought_trace: Mapped[List[Dict[str, Any]]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=list,
        server_default="[]",
        comment="思维链路摘要/步骤 (Step 1, Step 2...)",
    )

    total_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="本次会话消耗 Token 数",
    )

    # Relationships
    log: Mapped["SpecExecutionLog"] = relationship("SpecExecutionLog", back_populates="sessions")

    def __repr__(self) -> str:
        return f"<SpecWorkerSession(log_id={self.log_id})>"
