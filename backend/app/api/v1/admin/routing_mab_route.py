"""
Routing & MAB 管理员监控 API
提供平台级路由决策质量的聚合视图
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.superuser import get_current_superuser
from app.models import User
from app.models.bandit import BanditArmState
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.models.provider_preset import ProviderPreset
from app.repositories.bandit_repository import BanditRepository
from app.services.assistant.assistant_routing_service import AssistantRoutingService
from app.schemas.routing_mab import (
    AssistantMabResponse,
    ArmPerformanceItem,
    ArmPerformanceResponse,
    RoutingOverviewResponse,
    SkillMabResponse,
    StrategyConfigResponse,
)
from app.utils.time_utils import Datetime

router = APIRouter(prefix="/admin/routing-mab", tags=["Admin - Routing MAB"])


@router.get("/overview", response_model=RoutingOverviewResponse)
async def routing_overview(
    scene: str = Query("router:llm"),
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """平台级路由决策概览"""
    now = Datetime.now()

    stmt = select(
        func.count(BanditArmState.id).label("total_arms"),
        func.coalesce(func.sum(BanditArmState.total_trials), 0).label("total_trials"),
        func.coalesce(func.sum(BanditArmState.successes), 0).label("total_successes"),
    ).where(BanditArmState.scene == scene)
    result = await db.execute(stmt)
    row = result.one()

    total_arms = int(row.total_arms)
    total_trials = int(row.total_trials)
    total_successes = int(row.total_successes)
    overall_rate = (total_successes / total_trials) if total_trials > 0 else 0.0

    # Count cooldown arms
    cooldown_stmt = (
        select(func.count(BanditArmState.id))
        .where(
            BanditArmState.scene == scene,
            BanditArmState.cooldown_until.is_not(None),
            BanditArmState.cooldown_until > now,
        )
    )
    cooldown_result = await db.execute(cooldown_stmt)
    cooldown_arms = cooldown_result.scalar() or 0

    return RoutingOverviewResponse(
        total_trials=total_trials,
        overall_success_rate=round(overall_rate, 4),
        active_arms=total_arms - cooldown_arms,
        cooldown_arms=cooldown_arms,
        total_arms=total_arms,
    )


@router.get("/strategy", response_model=StrategyConfigResponse)
async def routing_strategy(
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """当前路由策略配置（取最常用策略）"""
    stmt = (
        select(
            BanditArmState.strategy,
            BanditArmState.epsilon,
            BanditArmState.alpha,
            BanditArmState.beta,
            func.count(BanditArmState.id).label("cnt"),
        )
        .where(BanditArmState.scene == "router:llm")
        .group_by(
            BanditArmState.strategy,
            BanditArmState.epsilon,
            BanditArmState.alpha,
            BanditArmState.beta,
        )
        .order_by(func.count(BanditArmState.id).desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    row = result.first()

    if not row:
        return StrategyConfigResponse()

    return StrategyConfigResponse(
        strategy=row.strategy or "thompson",
        epsilon=row.epsilon or 0.1,
        alpha=row.alpha or 1.0,
        beta=row.beta or 1.0,
    )


@router.get("/arms", response_model=ArmPerformanceResponse)
async def routing_arms(
    scene: str = Query("router:llm"),
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """供应商/模型臂表现列表"""
    now = Datetime.now()

    stmt = (
        select(
            BanditArmState,
            ProviderModel.model_id,
            ProviderPreset.provider.label("provider_name"),
        )
        .join(ProviderModel, BanditArmState.provider_model_id == ProviderModel.id)
        .join(ProviderInstance, ProviderModel.instance_id == ProviderInstance.id)
        .join(ProviderPreset, ProviderInstance.preset_slug == ProviderPreset.slug)
        .where(BanditArmState.scene == scene)
    )
    result = await db.execute(stmt)
    rows = result.all()

    total_trials = sum(r.BanditArmState.total_trials for r in rows)

    arms: list[ArmPerformanceItem] = []
    for row in rows:
        state: BanditArmState = row.BanditArmState
        trials = int(state.total_trials or 0)
        successes = int(state.successes or 0)
        success_rate = (successes / trials) if trials > 0 else 0.0
        avg_latency = (
            float(state.total_latency_ms) / trials if trials > 0 else 0.0
        )
        selection_ratio = (trials / total_trials) if total_trials > 0 else 0.0

        in_cooldown = (
            state.cooldown_until is not None and state.cooldown_until > now
        )

        arms.append(
            ArmPerformanceItem(
                provider=row.provider_name or "unknown",
                model=row.model_id or "unknown",
                arm_id=state.arm_id,
                status="cooldown" if in_cooldown else "active",
                cooldown_until=state.cooldown_until if in_cooldown else None,
                strategy=state.strategy or "epsilon_greedy",
                epsilon=state.epsilon,
                alpha=state.alpha,
                beta=state.beta,
                total_trials=trials,
                successes=successes,
                failures=int(state.failures or 0),
                success_rate=round(success_rate, 4),
                selection_ratio=round(selection_ratio, 4),
                avg_latency_ms=round(avg_latency, 1),
                latency_p95_ms=(
                    round(float(state.latency_p95_ms), 1)
                    if state.latency_p95_ms is not None
                    else None
                ),
                total_cost=float(state.total_cost),
                last_reward=float(state.last_reward),
            )
        )

    # Sort by selection_ratio descending
    arms.sort(key=lambda a: a.selection_ratio, reverse=True)

    return ArmPerformanceResponse(arms=arms)


@router.get("/skills", response_model=SkillMabResponse)
async def routing_skills(
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """技能路由 MAB 报表"""
    repo = BanditRepository(db)
    reports = await repo.get_skill_report()

    return SkillMabResponse(
        skills=[
            {
                "skillId": r.get("skill_id"),
                "skillName": r.get("skill_name"),
                "status": r.get("status"),
                "totalTrials": r.get("total_trials", 0),
                "successes": r.get("successes", 0),
                "failures": r.get("failures", 0),
                "successRate": round(r.get("success_rate", 0.0), 4),
                "selectionRatio": round(r.get("selection_ratio", 0.0), 4),
                "avgLatencyMs": round(r.get("avg_latency_ms", 0.0), 1),
                "isExploring": r.get("total_trials", 0) < 10,
            }
            for r in reports
        ]
    )


@router.get("/assistants", response_model=AssistantMabResponse)
async def routing_assistants(
    min_trials: int | None = Query(default=None, ge=0, description="最小试用次数"),
    min_rating: float | None = Query(
        default=None, ge=0.0, le=1.0, description="最小评分"
    ),
    limit: int | None = Query(default=50, ge=1, le=500, description="返回条数上限"),
    sort: str | None = Query(
        default="score_desc",
        description="排序方式：score_desc/rating_desc/trials_desc/recent_desc",
    ),
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """助手路由 MAB 报表"""
    allowed_sorts = {"score_desc", "rating_desc", "trials_desc", "recent_desc"}
    if sort is not None and sort.lower() not in allowed_sorts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid sort option",
        )

    service = AssistantRoutingService(db)
    reports = await service.list_routing_report(
        min_trials=min_trials,
        min_rating=min_rating,
        limit=limit,
        sort=sort,
    )
    total_trials = sum(int(item.get("total_trials") or 0) for item in reports)

    return AssistantMabResponse(
        assistants=[
            {
                "assistantId": str(r.get("assistant_id")),
                "name": r.get("name"),
                "summary": r.get("summary"),
                "totalTrials": int(r.get("total_trials") or 0),
                "positiveFeedback": int(r.get("positive_feedback") or 0),
                "negativeFeedback": int(r.get("negative_feedback") or 0),
                "ratingScore": round(float(r.get("rating_score") or 0.0), 4),
                "mabScore": round(float(r.get("mab_score") or 0.0), 4),
                "routingScore": round(float(r.get("routing_score") or 0.0), 4),
                "selectionRatio": round(
                    (int(r.get("total_trials") or 0) / total_trials)
                    if total_trials > 0
                    else 0.0,
                    4,
                ),
                "explorationBonus": round(float(r.get("exploration_bonus") or 0.0), 4),
                "lastUsedAt": r.get("last_used_at"),
                "lastFeedbackAt": r.get("last_feedback_at"),
                "isExploring": int(r.get("total_trials") or 0) < 10,
            }
            for r in reports
        ]
    )
