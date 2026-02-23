"""
Routing & MAB (Multi-Armed Bandit) monitoring schemas
用于管理员监控平台级路由决策质量
"""

from __future__ import annotations

from datetime import datetime

from pydantic import Field

from .base import BaseSchema


class ArmPerformanceItem(BaseSchema):
    provider: str
    model: str
    arm_id: str | None = Field(None, alias="armId")
    status: str  # "active" | "cooldown"
    cooldown_until: datetime | None = Field(None, alias="cooldownUntil")
    strategy: str
    epsilon: float = 0.1
    alpha: float = 1.0
    beta: float = 1.0
    total_trials: int = Field(0, alias="totalTrials")
    successes: int = 0
    failures: int = 0
    success_rate: float = Field(0.0, alias="successRate")
    selection_ratio: float = Field(0.0, alias="selectionRatio")
    avg_latency_ms: float = Field(0.0, alias="avgLatencyMs")
    latency_p95_ms: float | None = Field(None, alias="latencyP95Ms")
    total_cost: float = Field(0.0, alias="totalCost")
    last_reward: float = Field(0.0, alias="lastReward")


class RoutingOverviewResponse(BaseSchema):
    total_trials: int = Field(0, alias="totalTrials")
    overall_success_rate: float = Field(0.0, alias="overallSuccessRate")
    active_arms: int = Field(0, alias="activeArms")
    cooldown_arms: int = Field(0, alias="cooldownArms")
    total_arms: int = Field(0, alias="totalArms")


class StrategyConfigResponse(BaseSchema):
    strategy: str = "thompson"
    epsilon: float = 0.1
    alpha: float = 1.0
    beta: float = 1.0
    vector_weight: float = Field(0.75, alias="vectorWeight")
    bandit_weight: float = Field(0.25, alias="banditWeight")
    exploration_bonus: float = Field(0.3, alias="explorationBonus")


class ArmPerformanceResponse(BaseSchema):
    arms: list[ArmPerformanceItem]


class SkillArmItem(BaseSchema):
    skill_id: str | None = Field(None, alias="skillId")
    skill_name: str | None = Field(None, alias="skillName")
    status: str | None = None
    total_trials: int = Field(0, alias="totalTrials")
    successes: int = 0
    failures: int = 0
    success_rate: float = Field(0.0, alias="successRate")
    selection_ratio: float = Field(0.0, alias="selectionRatio")
    avg_latency_ms: float = Field(0.0, alias="avgLatencyMs")
    is_exploring: bool = Field(False, alias="isExploring")


class SkillMabResponse(BaseSchema):
    skills: list[SkillArmItem]


class AssistantArmItem(BaseSchema):
    assistant_id: str = Field(..., alias="assistantId")
    name: str | None = None
    summary: str | None = None
    total_trials: int = Field(0, alias="totalTrials")
    positive_feedback: int = Field(0, alias="positiveFeedback")
    negative_feedback: int = Field(0, alias="negativeFeedback")
    rating_score: float = Field(0.0, alias="ratingScore")
    mab_score: float = Field(0.0, alias="mabScore")
    routing_score: float = Field(0.0, alias="routingScore")
    selection_ratio: float = Field(0.0, alias="selectionRatio")
    exploration_bonus: float = Field(0.0, alias="explorationBonus")
    last_used_at: datetime | None = Field(None, alias="lastUsedAt")
    last_feedback_at: datetime | None = Field(None, alias="lastFeedbackAt")
    is_exploring: bool = Field(False, alias="isExploring")


class AssistantMabResponse(BaseSchema):
    assistants: list[AssistantArmItem]
