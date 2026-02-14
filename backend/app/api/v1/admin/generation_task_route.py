from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.superuser import get_current_superuser
from app.schemas.admin_ops import (
    GenerationOutputAdminListResponse,
    GenerationShareAdminItem,
    GenerationShareAdminListResponse,
    GenerationShareUpdateRequest,
    GenerationTaskAdminItem,
    GenerationTaskAdminListResponse,
)
from app.services.admin import GenerationAdminService

router = APIRouter(prefix="/admin", tags=["Admin - Generation Tasks"])


def get_service(db: AsyncSession = Depends(get_db)) -> GenerationAdminService:
    return GenerationAdminService(db)


@router.get("/generation-tasks", response_model=GenerationTaskAdminListResponse)
async def list_generation_tasks(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    task_type: str | None = Query(
        default=None,
        pattern="^(image_generation|text_to_speech|video_generation)$",
    ),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        pattern="^(queued|running|succeeded|failed|canceled)$",
    ),
    model: str | None = None,
    user_id: UUID | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    _=Depends(get_current_superuser),
    service: GenerationAdminService = Depends(get_service),
) -> GenerationTaskAdminListResponse:
    return await service.list_tasks(
        skip=skip,
        limit=limit,
        task_type=task_type,
        status_filter=status_filter,
        model=model,
        user_id=user_id,
        start_time=start_time,
        end_time=end_time,
    )


@router.get(
    "/generation-tasks/{task_id}",
    response_model=GenerationTaskAdminItem,
)
async def get_generation_task(
    task_id: UUID,
    _=Depends(get_current_superuser),
    service: GenerationAdminService = Depends(get_service),
) -> GenerationTaskAdminItem:
    task = await service.get_task(task_id)
    return GenerationTaskAdminItem.model_validate(task)


@router.get(
    "/generation-tasks/{task_id}/outputs",
    response_model=GenerationOutputAdminListResponse,
)
async def list_generation_task_outputs(
    task_id: UUID,
    _=Depends(get_current_superuser),
    service: GenerationAdminService = Depends(get_service),
) -> GenerationOutputAdminListResponse:
    return await service.list_outputs(task_id)


@router.get("/generation-shares", response_model=GenerationShareAdminListResponse)
async def list_generation_shares(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    is_active: bool | None = None,
    user_id: UUID | None = None,
    task_id: UUID | None = None,
    _=Depends(get_current_superuser),
    service: GenerationAdminService = Depends(get_service),
) -> GenerationShareAdminListResponse:
    return await service.list_shares(
        skip=skip,
        limit=limit,
        is_active=is_active,
        user_id=user_id,
        task_id=task_id,
    )


@router.patch(
    "/generation-shares/{share_id}",
    response_model=GenerationShareAdminItem,
)
async def update_generation_share(
    share_id: UUID,
    payload: GenerationShareUpdateRequest,
    _=Depends(get_current_superuser),
    service: GenerationAdminService = Depends(get_service),
) -> GenerationShareAdminItem:
    share = await service.update_share_active(
        share_id=share_id,
        is_active=payload.is_active,
    )
    return GenerationShareAdminItem.model_validate(share)
