from __future__ import annotations

from datetime import datetime
from typing import Dict, List

from pydantic import Field

from .base import BaseSchema


class CreditsBalanceResponse(BaseSchema):
    balance: float = 0
    monthly_spent: float = Field(0, alias="monthlySpent")
    used_percent: float = Field(0, alias="usedPercent")


class CreditsModelUsageItem(BaseSchema):
    model: str
    tokens: int
    percentage: float


class CreditsModelUsageResponse(BaseSchema):
    total_tokens: int = Field(0, alias="totalTokens")
    models: List[CreditsModelUsageItem]


class CreditsConsumptionPoint(BaseSchema):
    date: str
    tokens_by_model: Dict[str, int] = Field(default_factory=dict, alias="tokensByModel")


class CreditsConsumptionResponse(BaseSchema):
    start_date: str = Field(..., alias="startDate")
    end_date: str = Field(..., alias="endDate")
    days: int
    models: List[str]
    timeline: List[CreditsConsumptionPoint]


class CreditsTransactionItem(BaseSchema):
    id: str
    trace_id: str = Field(..., alias="traceId")
    model: str | None = None
    status: str
    amount: float
    input_tokens: int = Field(0, alias="inputTokens")
    output_tokens: int = Field(0, alias="outputTokens")
    total_tokens: int = Field(0, alias="totalTokens")
    created_at: datetime = Field(..., alias="createdAt")


class CreditsTransactionListResponse(BaseSchema):
    items: List[CreditsTransactionItem]
    next_offset: int | None = Field(None, alias="nextOffset")
