from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema, IDSchema, TimestampSchema


class SpecKnowledgeUsageStats(BaseSchema):
    positive_feedback: int = 0
    negative_feedback: int = 0
    apply_count: int = 0
    revert_count: int = 0
    error_count: int = 0
    total_runs: int = 0
    success_runs: int = 0
    success_rate: float = 0.0
    unique_sessions: int = 0


class SpecKnowledgeEvalSnapshot(BaseSchema):
    static_pass: bool = False
    llm_score: int | None = None
    critic_reason: str | None = None


class SpecKnowledgeCandidateDTO(IDSchema, TimestampSchema):
    canonical_hash: str
    status: str
    plan_id: UUID | None = None
    user_id: UUID | None = None
    project_name: str | None = None
    usage_stats: SpecKnowledgeUsageStats = Field(default_factory=SpecKnowledgeUsageStats)
    eval_snapshot: SpecKnowledgeEvalSnapshot = Field(default_factory=SpecKnowledgeEvalSnapshot)
    review_status: str | None = None
    last_positive_at: datetime | None = None
    last_negative_at: datetime | None = None
    last_eval_at: datetime | None = None
    promoted_at: datetime | None = None


class SpecKnowledgeReviewDecisionRequest(BaseSchema):
    reason: str | None = Field(None, description="审核备注/原因")


__all__ = [
    "SpecKnowledgeCandidateDTO",
    "SpecKnowledgeEvalSnapshot",
    "SpecKnowledgeReviewDecisionRequest",
    "SpecKnowledgeUsageStats",
]
