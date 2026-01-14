from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.schemas.dashboard import (
    DashboardStatsResponse,
    ProviderHealthItem,
    RecentErrorItem,
    SmartRouterStatsResponse,
    TokenThroughputResponse,
)
from app.services.dashboard.dashboard_service import DashboardService

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def get_dashboard_service(db: AsyncSession = Depends(get_db)) -> DashboardService:
    return DashboardService(db)


@router.get("/stats", response_model=DashboardStatsResponse)
async def get_dashboard_stats(
    current_user: User = Depends(get_current_user),
    svc: DashboardService = Depends(get_dashboard_service),
):
    return await svc.get_stats(str(current_user.id) if current_user else None)


@router.get("/token-throughput", response_model=TokenThroughputResponse)
async def get_token_throughput(
    period: str = Query("24h", pattern="^(24h|7d|30d)$"),
    current_user: User = Depends(get_current_user),
    svc: DashboardService = Depends(get_dashboard_service),
):
    return await svc.get_token_throughput(str(current_user.id) if current_user else None, period)


@router.get("/smart-router-stats", response_model=SmartRouterStatsResponse)
async def get_smart_router_stats(
    current_user: User = Depends(get_current_user),
    svc: DashboardService = Depends(get_dashboard_service),
):
    return await svc.get_smart_router_stats(str(current_user.id) if current_user else None)


@router.get("/provider-health", response_model=list[ProviderHealthItem])
async def get_provider_health(
    current_user: User = Depends(get_current_user),
    svc: DashboardService = Depends(get_dashboard_service),
):
    return await svc.get_provider_health(str(current_user.id) if current_user else None)


@router.get("/recent-errors", response_model=list[RecentErrorItem])
async def get_recent_errors(
    limit: int = Query(10, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    svc: DashboardService = Depends(get_dashboard_service),
):
    return await svc.get_recent_errors(str(current_user.id) if current_user else None, limit=limit)

