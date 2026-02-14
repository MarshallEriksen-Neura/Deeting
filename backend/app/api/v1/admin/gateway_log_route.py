from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.superuser import get_current_superuser
from app.schemas.admin_ops import (
    GatewayLogAdminItem,
    GatewayLogAdminListResponse,
    GatewayLogStatsResponse,
)
from app.services.admin import GatewayLogAdminService

router = APIRouter(prefix="/admin/gateway-logs", tags=["Admin - Gateway Logs"])


def get_service(db: AsyncSession = Depends(get_db)) -> GatewayLogAdminService:
    return GatewayLogAdminService(db)


@router.get("", response_model=GatewayLogAdminListResponse)
async def list_gateway_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    model: str | None = None,
    status_code: int | None = None,
    user_id: UUID | None = None,
    api_key_id: UUID | None = None,
    error_code: str | None = None,
    is_cached: bool | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    _=Depends(get_current_superuser),
    service: GatewayLogAdminService = Depends(get_service),
) -> GatewayLogAdminListResponse:
    return await service.list_logs(
        skip=skip,
        limit=limit,
        model=model,
        status_code=status_code,
        user_id=user_id,
        api_key_id=api_key_id,
        error_code=error_code,
        is_cached=is_cached,
        start_time=start_time,
        end_time=end_time,
    )


@router.get("/stats", response_model=GatewayLogStatsResponse)
async def get_gateway_logs_stats(
    model: str | None = None,
    status_code: int | None = None,
    user_id: UUID | None = None,
    api_key_id: UUID | None = None,
    error_code: str | None = None,
    is_cached: bool | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    _=Depends(get_current_superuser),
    service: GatewayLogAdminService = Depends(get_service),
) -> GatewayLogStatsResponse:
    return await service.get_stats(
        model=model,
        status_code=status_code,
        user_id=user_id,
        api_key_id=api_key_id,
        error_code=error_code,
        is_cached=is_cached,
        start_time=start_time,
        end_time=end_time,
    )


@router.get("/{log_id}", response_model=GatewayLogAdminItem)
async def get_gateway_log(
    log_id: UUID,
    _=Depends(get_current_superuser),
    service: GatewayLogAdminService = Depends(get_service),
) -> GatewayLogAdminItem:
    return await service.get_log(log_id)
