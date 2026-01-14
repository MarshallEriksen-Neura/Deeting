from __future__ import annotations

from typing import List

from pydantic import Field

from .base import BaseSchema


class LatencyHeatmapCell(BaseSchema):
    intensity: float
    count: int


class LatencyHeatmapResponse(BaseSchema):
    grid: List[List[LatencyHeatmapCell]]
    peak_latency: float = Field(0, alias="peakLatency")
    median_latency: float = Field(0, alias="medianLatency")


class PercentilePoint(BaseSchema):
    time: str
    p50: float
    p99: float


class PercentileTrendsResponse(BaseSchema):
    timeline: List[PercentilePoint]


class ModelCostItem(BaseSchema):
    name: str
    cost: float
    percentage: float


class ModelCostBreakdownResponse(BaseSchema):
    models: List[ModelCostItem]


class ErrorCategoryItem(BaseSchema):
    category: str
    label: str
    count: int
    color: str


class ErrorDistributionResponse(BaseSchema):
    categories: List[ErrorCategoryItem]


class KeyActivityItem(BaseSchema):
    id: str
    name: str
    masked_key: str = Field(..., alias="maskedKey")
    rpm: float
    trend: float


class KeyActivityRankingResponse(BaseSchema):
    keys: List[KeyActivityItem]
