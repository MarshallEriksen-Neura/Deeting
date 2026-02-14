from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.superuser import get_current_superuser
from app.schemas.admin_ops import (
    SpecExecutionLogAdminListResponse,
    SpecPlanAdminItem,
    SpecPlanAdminListResponse,
    SpecWorkerSessionAdminListResponse,
)
from app.services.admin import SpecPlanAdminService

router = APIRouter(prefix="/admin", tags=["Admin - Spec Plans"])


def get_service(db: AsyncSession = Depends(get_db)) -> SpecPlanAdminService:
    return SpecPlanAdminService(db)


@router.get("/spec-plans", response_model=SpecPlanAdminListResponse)
async def list_spec_plans(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        pattern="^(DRAFT|RUNNING|PAUSED|COMPLETED|FAILED)$",
    ),
    user_id: UUID | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    _=Depends(get_current_superuser),
    service: SpecPlanAdminService = Depends(get_service),
) -> SpecPlanAdminListResponse:
    return await service.list_plans(
        skip=skip,
        limit=limit,
        status_filter=status_filter,
        user_id=user_id,
        start_time=start_time,
        end_time=end_time,
    )


@router.get("/spec-plans/{plan_id}", response_model=SpecPlanAdminItem)
async def get_spec_plan(
    plan_id: UUID,
    _=Depends(get_current_superuser),
    service: SpecPlanAdminService = Depends(get_service),
) -> SpecPlanAdminItem:
    plan = await service.get_plan(plan_id)
    return SpecPlanAdminItem.model_validate(plan)


@router.get(
    "/spec-plans/{plan_id}/logs",
    response_model=SpecExecutionLogAdminListResponse,
)
async def list_spec_logs(
    plan_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    status_filter: str | None = Query(default=None, alias="status"),
    _=Depends(get_current_superuser),
    service: SpecPlanAdminService = Depends(get_service),
) -> SpecExecutionLogAdminListResponse:
    return await service.list_logs(
        plan_id=plan_id,
        skip=skip,
        limit=limit,
        status_filter=status_filter,
    )


@router.get(
    "/spec-logs/{log_id}/sessions",
    response_model=SpecWorkerSessionAdminListResponse,
)
async def list_spec_worker_sessions(
    log_id: UUID,
    _=Depends(get_current_superuser),
    service: SpecPlanAdminService = Depends(get_service),
) -> SpecWorkerSessionAdminListResponse:
    return await service.list_sessions(log_id=log_id)


@router.post("/spec-plans/{plan_id}/pause", response_model=SpecPlanAdminItem)
async def pause_spec_plan(
    plan_id: UUID,
    _=Depends(get_current_superuser),
    service: SpecPlanAdminService = Depends(get_service),
) -> SpecPlanAdminItem:
    plan = await service.update_plan_status(plan_id=plan_id, status_value="PAUSED")
    return SpecPlanAdminItem.model_validate(plan)


@router.post("/spec-plans/{plan_id}/resume", response_model=SpecPlanAdminItem)
async def resume_spec_plan(
    plan_id: UUID,
    _=Depends(get_current_superuser),
    service: SpecPlanAdminService = Depends(get_service),
) -> SpecPlanAdminItem:
    plan = await service.update_plan_status(plan_id=plan_id, status_value="RUNNING")
    return SpecPlanAdminItem.model_validate(plan)
