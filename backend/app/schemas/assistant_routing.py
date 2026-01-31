from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class AssistantRoutingReportItem(BaseModel):
    assistant_id: UUID
    name: str | None
    summary: str | None
    total_trials: int
    positive_feedback: int
    negative_feedback: int
    rating_score: float = Field(..., description="平滑后的评分（Beta 期望）")
    mab_score: float = Field(..., description="MAB 期望值（当前与 rating_score 一致）")
    routing_score: float = Field(..., description="路由排序分数（MAB + 探索权重）")
    exploration_bonus: float = Field(..., description="探索奖励（试用数不足时生效）")
    last_used_at: datetime | None
    last_feedback_at: datetime | None


class AssistantRoutingReportSummary(BaseModel):
    total_assistants: int = Field(..., description="统计的专家数量")
    total_trials: int = Field(..., description="总尝试次数")
    total_positive: int = Field(..., description="正向反馈总数")
    total_negative: int = Field(..., description="负向反馈总数")
    overall_rating: float = Field(..., description="平均评分")


class AssistantRoutingReportResponse(BaseModel):
    summary: AssistantRoutingReportSummary
    items: list[AssistantRoutingReportItem]
