from __future__ import annotations

from pydantic import Field

from .base import BaseSchema


class LatencyHeatmapCell(BaseSchema):
    intensity: float
    count: int


class LatencyHeatmapResponse(BaseSchema):
    grid: list[list[LatencyHeatmapCell]]
    peak_latency: float = Field(0, alias="peakLatency")
    median_latency: float = Field(0, alias="medianLatency")


class PercentilePoint(BaseSchema):
    time: str
    p50: float
    p99: float


class PercentileTrendsResponse(BaseSchema):
    timeline: list[PercentilePoint]


class ModelCostItem(BaseSchema):
    name: str
    cost: float
    percentage: float


class ModelCostBreakdownResponse(BaseSchema):
    models: list[ModelCostItem]


class ErrorCategoryItem(BaseSchema):
    category: str
    label: str
    count: int
    color: str


class ErrorDistributionResponse(BaseSchema):
    categories: list[ErrorCategoryItem]


class KeyActivityItem(BaseSchema):
    id: str
    name: str
    masked_key: str = Field(..., alias="maskedKey")
    rpm: float
    trend: float


class KeyActivityRankingResponse(BaseSchema):
    keys: list[KeyActivityItem]
