from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.spec_agent import SpecExecutionLog, SpecPlan, SpecWorkerSession
from app.schemas.admin_ops import (
    SpecExecutionLogAdminItem,
    SpecExecutionLogAdminListResponse,
    SpecPlanAdminItem,
    SpecPlanAdminListResponse,
    SpecWorkerSessionAdminItem,
    SpecWorkerSessionAdminListResponse,
)


class SpecPlanAdminService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_plans(
        self,
        *,
        skip: int,
        limit: int,
        status_filter: str | None = None,
        user_id: UUID | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> SpecPlanAdminListResponse:
        conditions = []
        if status_filter:
            conditions.append(SpecPlan.status == status_filter)
        if user_id:
            conditions.append(SpecPlan.user_id == user_id)
        if start_time:
            conditions.append(SpecPlan.created_at >= start_time)
        if end_time:
            conditions.append(SpecPlan.created_at <= end_time)

        stmt = select(SpecPlan)
        count_stmt = select(func.count()).select_from(SpecPlan)
        if conditions:
            stmt = stmt.where(*conditions)
            count_stmt = count_stmt.where(*conditions)

        stmt = stmt.order_by(SpecPlan.created_at.desc(), SpecPlan.id.desc()).offset(
            skip
        ).limit(limit)

        rows = (await self.db.execute(stmt)).scalars().all()
        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        return SpecPlanAdminListResponse(
            items=[SpecPlanAdminItem.model_validate(row) for row in rows],
            total=total,
            skip=skip,
            limit=limit,
        )

    async def get_plan(self, plan_id: UUID) -> SpecPlan:
        plan = await self.db.get(SpecPlan, plan_id)
        if not plan:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="spec plan not found",
            )
        return plan

    async def list_logs(
        self,
        *,
        plan_id: UUID,
        skip: int,
        limit: int,
        status_filter: str | None = None,
    ) -> SpecExecutionLogAdminListResponse:
        await self.get_plan(plan_id)

        conditions = [SpecExecutionLog.plan_id == plan_id]
        if status_filter:
            conditions.append(SpecExecutionLog.status == status_filter)

        stmt = (
            select(SpecExecutionLog)
            .where(*conditions)
            .order_by(SpecExecutionLog.created_at.desc(), SpecExecutionLog.id.desc())
            .offset(skip)
            .limit(limit)
        )
        count_stmt = select(func.count()).select_from(SpecExecutionLog).where(*conditions)

        rows = (await self.db.execute(stmt)).scalars().all()
        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        return SpecExecutionLogAdminListResponse(
            items=[SpecExecutionLogAdminItem.model_validate(row) for row in rows],
            total=total,
            skip=skip,
            limit=limit,
        )

    async def list_sessions(
        self,
        *,
        log_id: UUID,
    ) -> SpecWorkerSessionAdminListResponse:
        log = await self.db.get(SpecExecutionLog, log_id)
        if not log:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="spec execution log not found",
            )

        stmt = (
            select(SpecWorkerSession)
            .where(SpecWorkerSession.log_id == log_id)
            .order_by(SpecWorkerSession.created_at.desc(), SpecWorkerSession.id.desc())
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return SpecWorkerSessionAdminListResponse(
            items=[SpecWorkerSessionAdminItem.model_validate(row) for row in rows]
        )

    async def update_plan_status(self, *, plan_id: UUID, status_value: str) -> SpecPlan:
        plan = await self.get_plan(plan_id)
        plan.status = status_value
        await self.db.commit()
        await self.db.refresh(plan)
        return plan
