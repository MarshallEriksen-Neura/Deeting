from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from .base import BaseSchema, IDSchema, TimestampSchema


class TraceFeedbackRequest(BaseSchema):
    trace_id: str = Field(..., max_length=64, description="请求追踪 ID")
    score: float = Field(..., ge=-1.0, le=1.0, description="评分（-1.0 ~ 1.0）")
    comment: str | None = Field(None, description="可选备注")
    tags: list[str] | None = Field(None, description="标签")


class TraceFeedbackResponse(IDSchema, TimestampSchema):
    trace_id: str
    score: float
    comment: str | None = None
    tags: list[str] | None = None


class TraceFeedbackDTO(IDSchema):
    trace_id: str
    score: float
    comment: str | None = None
    tags: list[str] | None = None
    created_at: datetime


__all__ = [
    "TraceFeedbackRequest",
    "TraceFeedbackResponse",
    "TraceFeedbackDTO",
]
