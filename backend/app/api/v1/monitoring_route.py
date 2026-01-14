from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.schemas.monitoring import (
    ErrorDistributionResponse,
    KeyActivityRankingResponse,
    LatencyHeatmapResponse,
    ModelCostBreakdownResponse,
    PercentileTrendsResponse,
)
from app.services.monitoring.monitoring_service import MonitoringService

router = APIRouter(prefix="/monitoring", tags=["Monitoring"])


def get_monitoring_service(db: AsyncSession = Depends(get_db)) -> MonitoringService:
    return MonitoringService(db)


@router.get("/latency-heatmap", response_model=LatencyHeatmapResponse)
async def latency_heatmap(
    time_range: str = Query("24h", pattern="^(24h|7d|30d)$", alias="timeRange"),
    model: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    svc: MonitoringService = Depends(get_monitoring_service),
):
    return await svc.get_latency_heatmap(str(current_user.id) if current_user else None, time_range, model)


@router.get("/percentile-trends", response_model=PercentileTrendsResponse)
async def percentile_trends(
    time_range: str = Query("24h", pattern="^(24h|7d|30d)$", alias="timeRange"),
    current_user: User = Depends(get_current_user),
    svc: MonitoringService = Depends(get_monitoring_service),
):
    return await svc.get_percentile_trends(str(current_user.id) if current_user else None, time_range)


@router.get("/model-cost-breakdown", response_model=ModelCostBreakdownResponse)
async def model_cost_breakdown(
    time_range: str = Query("24h", pattern="^(24h|7d|30d)$", alias="timeRange"),
    current_user: User = Depends(get_current_user),
    svc: MonitoringService = Depends(get_monitoring_service),
):
    return await svc.get_model_cost_breakdown(str(current_user.id) if current_user else None, time_range)


@router.get("/error-distribution", response_model=ErrorDistributionResponse)
async def error_distribution(
    time_range: str = Query("24h", pattern="^(24h|7d|30d)$", alias="timeRange"),
    model: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    svc: MonitoringService = Depends(get_monitoring_service),
):
    return await svc.get_error_distribution(str(current_user.id) if current_user else None, time_range, model)


@router.get("/key-activity-ranking", response_model=KeyActivityRankingResponse)
async def key_activity_ranking(
    time_range: str = Query("24h", pattern="^(24h|7d|30d)$", alias="timeRange"),
    limit: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    svc: MonitoringService = Depends(get_monitoring_service),
):
    return await svc.get_key_activity_ranking(str(current_user.id) if current_user else None, time_range, limit)
