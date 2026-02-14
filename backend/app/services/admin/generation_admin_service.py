from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_generation import (
    GenerationTask,
    ImageGenerationOutput,
    ImageGenerationShare,
)
from app.schemas.admin_ops import (
    GenerationOutputAdminItem,
    GenerationOutputAdminListResponse,
    GenerationShareAdminItem,
    GenerationShareAdminListResponse,
    GenerationTaskAdminItem,
    GenerationTaskAdminListResponse,
)
from app.utils.time_utils import Datetime


class GenerationAdminService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_tasks(
        self,
        *,
        skip: int,
        limit: int,
        task_type: str | None = None,
        status_filter: str | None = None,
        model: str | None = None,
        user_id: UUID | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> GenerationTaskAdminListResponse:
        conditions = []
        if task_type:
            conditions.append(GenerationTask.task_type == task_type)
        if status_filter:
            conditions.append(GenerationTask.status == status_filter)
        if model:
            conditions.append(GenerationTask.model == model)
        if user_id:
            conditions.append(GenerationTask.user_id == user_id)
        if start_time:
            conditions.append(GenerationTask.created_at >= start_time)
        if end_time:
            conditions.append(GenerationTask.created_at <= end_time)

        stmt = select(GenerationTask)
        count_stmt = select(func.count()).select_from(GenerationTask)
        if conditions:
            stmt = stmt.where(*conditions)
            count_stmt = count_stmt.where(*conditions)

        stmt = (
            stmt.order_by(GenerationTask.created_at.desc(), GenerationTask.id.desc())
            .offset(skip)
            .limit(limit)
        )

        rows = (await self.db.execute(stmt)).scalars().all()
        total = int((await self.db.execute(count_stmt)).scalar() or 0)
        return GenerationTaskAdminListResponse(
            items=[GenerationTaskAdminItem.model_validate(row) for row in rows],
            total=total,
            skip=skip,
            limit=limit,
        )

    async def get_task(self, task_id: UUID) -> GenerationTask:
        task = await self.db.get(GenerationTask, task_id)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="generation task not found",
            )
        return task

    async def list_outputs(self, task_id: UUID) -> GenerationOutputAdminListResponse:
        await self.get_task(task_id)
        stmt = (
            select(ImageGenerationOutput)
            .where(ImageGenerationOutput.task_id == task_id)
            .order_by(ImageGenerationOutput.output_index.asc())
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return GenerationOutputAdminListResponse(
            items=[GenerationOutputAdminItem.model_validate(row) for row in rows]
        )

    async def list_shares(
        self,
        *,
        skip: int,
        limit: int,
        is_active: bool | None = None,
        user_id: UUID | None = None,
        task_id: UUID | None = None,
    ) -> GenerationShareAdminListResponse:
        conditions = []
        if is_active is not None:
            conditions.append(ImageGenerationShare.is_active == is_active)
        if user_id:
            conditions.append(ImageGenerationShare.user_id == user_id)
        if task_id:
            conditions.append(ImageGenerationShare.task_id == task_id)

        stmt = select(ImageGenerationShare)
        count_stmt = select(func.count()).select_from(ImageGenerationShare)
        if conditions:
            stmt = stmt.where(*conditions)
            count_stmt = count_stmt.where(*conditions)

        stmt = stmt.order_by(ImageGenerationShare.shared_at.desc(), ImageGenerationShare.id.desc()).offset(
            skip
        ).limit(limit)

        rows = (await self.db.execute(stmt)).scalars().all()
        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        return GenerationShareAdminListResponse(
            items=[GenerationShareAdminItem.model_validate(row) for row in rows],
            total=total,
            skip=skip,
            limit=limit,
        )

    async def update_share_active(
        self, share_id: UUID, is_active: bool
    ) -> ImageGenerationShare:
        share = await self.db.get(ImageGenerationShare, share_id)
        if not share:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="generation share not found",
            )

        share.is_active = is_active
        share.revoked_at = None if is_active else Datetime.now()
        await self.db.commit()
        await self.db.refresh(share)
        return share
