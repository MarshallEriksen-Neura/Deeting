from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.provider_preset import JSONBCompat


class SpecKnowledgeCandidate(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Spec Knowledge Candidate (三层漏斗候选条目)
    记录候选 Spec 的聚合反馈、评估结果与晋升状态。
    """

    __tablename__ = "spec_kb_candidate"
    __table_args__ = (
        Index("ix_spec_kb_candidate_hash", "canonical_hash", unique=True),
        Index("ix_spec_kb_candidate_status", "status"),
    )

    canonical_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment="规范化哈希（去重）",
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
        comment="触发候选的用户 ID",
    )

    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("spec_plan.id", ondelete="SET NULL"),
        nullable=True,
        comment="来源 Plan ID",
    )

    manifest_data: Mapped[Dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="原始 Spec Manifest",
    )

    normalized_manifest: Mapped[Dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="规范化 Manifest（用于 Hash/Embedding）",
    )

    status: Mapped[str] = mapped_column(
        String(24),
        nullable=False,
        default="pending_signal",
        server_default="'pending_signal'",
        comment="pending_signal/pending_eval/pending_review/approved/rejected/disabled",
    )

    positive_feedback: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="正向反馈计数",
    )

    negative_feedback: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="负向反馈计数",
    )

    apply_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="应用/采纳计数",
    )

    revert_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="回滚次数",
    )

    error_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="错误次数",
    )

    total_runs: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="总运行次数",
    )

    success_runs: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="成功运行次数",
    )

    session_hashes: Mapped[List[str]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=list,
        server_default="[]",
        comment="触发过的会话哈希集合（用于去重统计）",
    )

    eval_static_pass: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="静态规则是否通过",
    )

    eval_llm_score: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="LLM 评分（0-100）",
    )

    eval_reason: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="评估原因/说明",
    )

    eval_snapshot: Mapped[Dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="评估快照（静态 + LLM）",
    )

    trust_weight: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.0,
        server_default="1.0",
        comment="贡献者/采纳者信任权重",
    )

    exploration_tag: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
        comment="探索/高热度标签",
    )

    last_positive_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最近正向反馈时间",
    )

    last_negative_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最近负向反馈时间",
    )

    last_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最近应用时间",
    )

    last_reverted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最近回滚时间",
    )

    last_eval_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="最近评估时间",
    )

    promoted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="晋升时间",
    )

    def __repr__(self) -> str:
        return f"<SpecKnowledgeCandidate(hash={self.canonical_hash}, status={self.status})>"
