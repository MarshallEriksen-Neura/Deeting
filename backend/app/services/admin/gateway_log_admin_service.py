from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import String, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gateway_log import GatewayLog
from app.schemas.admin_ops import (
    GatewayLogAdminItem,
    GatewayLogAdminListResponse,
    GatewayLogStatsBucket,
    GatewayLogStatsResponse,
)


class GatewayLogAdminService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _conditions(
        self,
        *,
        model: str | None = None,
        status_code: int | None = None,
        user_id: UUID | None = None,
        api_key_id: UUID | None = None,
        error_code: str | None = None,
        is_cached: bool | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ):
        conditions = []
        if model:
            conditions.append(GatewayLog.model == model)
        if status_code is not None:
            conditions.append(GatewayLog.status_code == status_code)
        if user_id:
            conditions.append(GatewayLog.user_id == user_id)
        if api_key_id:
            conditions.append(GatewayLog.api_key_id == api_key_id)
        if error_code:
            conditions.append(GatewayLog.error_code == error_code)
        if is_cached is not None:
            conditions.append(GatewayLog.is_cached == is_cached)
        if start_time:
            conditions.append(GatewayLog.created_at >= start_time)
        if end_time:
            conditions.append(GatewayLog.created_at <= end_time)
        return conditions

    async def list_logs(
        self,
        *,
        skip: int,
        limit: int,
        model: str | None = None,
        status_code: int | None = None,
        user_id: UUID | None = None,
        api_key_id: UUID | None = None,
        error_code: str | None = None,
        is_cached: bool | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> GatewayLogAdminListResponse:
        conditions = self._conditions(
            model=model,
            status_code=status_code,
            user_id=user_id,
            api_key_id=api_key_id,
            error_code=error_code,
            is_cached=is_cached,
            start_time=start_time,
            end_time=end_time,
        )

        stmt = select(GatewayLog)
        count_stmt = select(func.count()).select_from(GatewayLog)
        if conditions:
            stmt = stmt.where(*conditions)
            count_stmt = count_stmt.where(*conditions)

        stmt = stmt.order_by(GatewayLog.created_at.desc(), GatewayLog.id.desc()).offset(
            skip
        ).limit(limit)

        rows = (await self.db.execute(stmt)).scalars().all()
        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        return GatewayLogAdminListResponse(
            items=[GatewayLogAdminItem.model_validate(row) for row in rows],
            total=total,
            skip=skip,
            limit=limit,
        )

    async def get_log(self, log_id: UUID) -> GatewayLogAdminItem:
        log = await self.db.get(GatewayLog, log_id)
        if not log:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="gateway log not found",
            )
        return GatewayLogAdminItem.model_validate(log)

    async def get_stats(
        self,
        *,
        model: str | None = None,
        status_code: int | None = None,
        user_id: UUID | None = None,
        api_key_id: UUID | None = None,
        error_code: str | None = None,
        is_cached: bool | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> GatewayLogStatsResponse:
        conditions = self._conditions(
            model=model,
            status_code=status_code,
            user_id=user_id,
            api_key_id=api_key_id,
            error_code=error_code,
            is_cached=is_cached,
            start_time=start_time,
            end_time=end_time,
        )

        total_stmt = select(func.count()).select_from(GatewayLog)
        success_stmt = select(func.count()).select_from(GatewayLog).where(
            GatewayLog.status_code >= 200,
            GatewayLog.status_code < 400,
        )
        cached_stmt = select(func.count()).select_from(GatewayLog).where(
            GatewayLog.is_cached.is_(True)
        )

        if conditions:
            total_stmt = total_stmt.where(*conditions)
            success_stmt = success_stmt.where(*conditions)
            cached_stmt = cached_stmt.where(*conditions)

        total = int((await self.db.execute(total_stmt)).scalar() or 0)
        success_count = int((await self.db.execute(success_stmt)).scalar() or 0)
        cached_count = int((await self.db.execute(cached_stmt)).scalar() or 0)

        error_key = func.coalesce(
            GatewayLog.error_code, func.cast(GatewayLog.status_code, String)
        )
        error_stmt = (
            select(error_key.label("bucket"), func.count().label("count"))
            .group_by("bucket")
            .order_by(func.count().desc())
            .limit(20)
        )
        model_stmt = (
            select(GatewayLog.model.label("bucket"), func.count().label("count"))
            .group_by(GatewayLog.model)
            .order_by(func.count().desc())
            .limit(20)
        )
        latency_bucket = case(
            (GatewayLog.duration_ms < 200, "lt_200ms"),
            (GatewayLog.duration_ms < 500, "200_500ms"),
            (GatewayLog.duration_ms < 1000, "500_1000ms"),
            else_="gte_1000ms",
        )
        latency_stmt = (
            select(latency_bucket.label("bucket"), func.count().label("count"))
            .group_by("bucket")
            .order_by(func.count().desc())
        )

        if conditions:
            error_stmt = error_stmt.where(*conditions)
            model_stmt = model_stmt.where(*conditions)
            latency_stmt = latency_stmt.where(*conditions)

        error_rows = (await self.db.execute(error_stmt)).all()
        model_rows = (await self.db.execute(model_stmt)).all()
        latency_rows = (await self.db.execute(latency_stmt)).all()

        return GatewayLogStatsResponse(
            total=total,
            success_rate=round((success_count / total) * 100, 2) if total else 0.0,
            cache_hit_rate=round((cached_count / total) * 100, 2) if total else 0.0,
            error_distribution=[
                GatewayLogStatsBucket(key=str(row.bucket), count=int(row.count))
                for row in error_rows
            ],
            model_ranking=[
                GatewayLogStatsBucket(key=str(row.bucket), count=int(row.count))
                for row in model_rows
            ],
            latency_histogram=[
                GatewayLogStatsBucket(key=str(row.bucket), count=int(row.count))
                for row in latency_rows
            ],
        )
