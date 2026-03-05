from __future__ import annotations

from datetime import datetime

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
    models: list[CreditsModelUsageItem]


class CreditsConsumptionPoint(BaseSchema):
    date: str
    tokens_by_model: dict[str, int] = Field(default_factory=dict, alias="tokensByModel")


class CreditsConsumptionResponse(BaseSchema):
    start_date: str = Field(..., alias="startDate")
    end_date: str = Field(..., alias="endDate")
    days: int
    models: list[str]
    timeline: list[CreditsConsumptionPoint]


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
    items: list[CreditsTransactionItem]
    next_offset: int | None = Field(None, alias="nextOffset")


class CreditsRechargePolicyResponse(BaseSchema):
    credit_per_unit: float = Field(..., alias="creditPerUnit")
    currency: str


class CreditsRechargeRequest(BaseSchema):
    amount: float = Field(..., gt=0)


class CreditsRechargeResponse(BaseSchema):
    amount: float
    credited_amount: float = Field(..., alias="creditedAmount")
    currency: str
    balance: float
    trace_id: str = Field(..., alias="traceId")
