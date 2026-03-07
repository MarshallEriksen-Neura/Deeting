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


class CreditsAlipayOrderRequest(BaseSchema):
    amount: float = Field(..., gt=0)


class CreditsAlipayOrderResponse(BaseSchema):
    out_trade_no: str = Field(..., alias="outTradeNo")
    pay_url: str = Field(..., alias="payUrl")
    amount: float
    currency: str
    expected_credited_amount: float = Field(..., alias="expectedCreditedAmount")


class CreditsAlipayOrderStatusResponse(BaseSchema):
    out_trade_no: str = Field(..., alias="outTradeNo")
    status: str
    trade_status: str | None = Field(None, alias="tradeStatus")
    trade_no: str | None = Field(None, alias="tradeNo")
    amount: float
    currency: str
    expected_credited_amount: float = Field(..., alias="expectedCreditedAmount")
    credited_amount: float = Field(0, alias="creditedAmount")
    refreshed: bool = False


class CreditsRechargeResponse(BaseSchema):
    amount: float
    credited_amount: float = Field(..., alias="creditedAmount")
    currency: str
    balance: float
    trace_id: str = Field(..., alias="traceId")


# 平台模型（积分计费代理用，桌面端同步到本地「平台」实例）
class CreditsPlatformModel(BaseSchema):
    id: str
    model_id: str
    display_name: str | None = None
    capabilities: list[str] = Field(default_factory=list)
    pricing: dict | None = None
    provider_name: str = ""
    provider_slug: str = ""
    provider_icon: str | None = None
    provider_color: str | None = None


class CreditsPlatformModelsResponse(BaseSchema):
    models: list[CreditsPlatformModel]
