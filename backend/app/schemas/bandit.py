"""
Bandit 观测报表 Schema
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class BanditArmReport(BaseModel):
    instance_id: str
    provider_model_id: str
    provider: str
    capability: str
    model: str
    scene: str | None = None
    arm_id: str | None = None
    reward_metric_type: str | None = None
    strategy: str
    epsilon: float
    alpha: float
    beta: float
    total_trials: int
    successes: int
    failures: int
    success_rate: float
    selection_ratio: float
    avg_latency_ms: float
    latency_p95_ms: float | None
    total_cost: float
    last_reward: float
    cooldown_until: datetime | None
    weight: int
    priority: int
    version: int


class BanditReportSummary(BaseModel):
    total_arms: int = Field(..., description="臂数量")
    total_trials: int = Field(..., description="总尝试次数")
    overall_success_rate: float = Field(..., description="全局成功率")


class BanditReportResponse(BaseModel):
    summary: BanditReportSummary
    items: list[BanditArmReport]


class BanditSkillReportItem(BaseModel):
    skill_id: str | None
    skill_name: str | None
    status: str | None
    scene: str | None = None
    arm_id: str | None = None
    reward_metric_type: str | None = None
    strategy: str | None
    epsilon: float | None
    alpha: float
    beta: float
    total_trials: int
    successes: int
    failures: int
    success_rate: float
    selection_ratio: float
    avg_latency_ms: float
    latency_p95_ms: float | None
    total_cost: float
    last_reward: float
    cooldown_until: datetime | None
    version: int


class BanditSkillReportResponse(BaseModel):
    summary: BanditReportSummary
    items: list[BanditSkillReportItem]
