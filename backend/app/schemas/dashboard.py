from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import Field

from .base import BaseSchema


class FinancialStats(BaseSchema):
    monthly_spent: float = Field(0, alias="monthlySpent")
    balance: float = 0
    quota_used_percent: float = Field(0, alias="quotaUsedPercent")
    estimated_month_end: Optional[float] = Field(None, alias="estimatedMonthEnd")


class TrafficStats(BaseSchema):
    today_requests: int = Field(0, alias="todayRequests")
    hourly_trend: List[int] = Field(default_factory=list, alias="hourlyTrend")
    trend_percent: Optional[float] = Field(None, alias="trendPercent")


class SpeedStats(BaseSchema):
    avg_ttft: float = Field(0, alias="avgTTFT")
    trend_percent: Optional[float] = Field(None, alias="trendPercent")


class HealthStats(BaseSchema):
    success_rate: float = Field(0, alias="successRate")
    total_requests: int = Field(0, alias="totalRequests")
    successful_requests: int = Field(0, alias="successfulRequests")


class DashboardStatsResponse(BaseSchema):
    financial: FinancialStats
    traffic: TrafficStats
    speed: SpeedStats
    health: HealthStats


class TokenTimelinePoint(BaseSchema):
    time: str
    input_tokens: int = Field(0, alias="inputTokens")
    output_tokens: int = Field(0, alias="outputTokens")


class TokenThroughputResponse(BaseSchema):
    timeline: List[TokenTimelinePoint]
    total_input: int = Field(0, alias="totalInput")
    total_output: int = Field(0, alias="totalOutput")
    ratio: float


class SmartRouterStatsResponse(BaseSchema):
    cache_hit_rate: float = Field(0, alias="cacheHitRate")
    cost_savings: float = Field(0, alias="costSavings")
    requests_blocked: int = Field(0, alias="requestsBlocked")
    avg_speedup: float = Field(0, alias="avgSpeedup")


class ProviderHealthItem(BaseSchema):
    id: str
    name: str
    status: str
    priority: int
    latency: int
    sparkline: List[int] | None = None


class RecentErrorItem(BaseSchema):
    id: str
    timestamp: datetime
    status_code: int = Field(..., alias="statusCode")
    model: str
    error_message: str = Field(..., alias="errorMessage")
    error_code: str | None = Field(None, alias="errorCode")

