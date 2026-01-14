from datetime import datetime
from uuid import UUID

from sqlalchemy import select, and_

from app.models.gateway_log import GatewayLog

from .base import BaseRepository


class GatewayLogRepository(BaseRepository[GatewayLog]):
    model = GatewayLog

    def build_query(
        self,
        *,
        user_id: UUID | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        model: str | None = None,
        status_code: int | None = None,
        is_cached: bool | None = None,
        error_code: str | None = None,
    ):
        """
        构造网关日志的基础查询，按 created_at/uuid 倒序，便于游标分页。
        """
        conditions = []
        if user_id:
            conditions.append(GatewayLog.user_id == user_id)
        if start_time:
            conditions.append(GatewayLog.created_at >= start_time)
        if end_time:
            conditions.append(GatewayLog.created_at <= end_time)
        if model:
            conditions.append(GatewayLog.model == model)
        if status_code:
            conditions.append(GatewayLog.status_code == status_code)
        if is_cached is not None:
            conditions.append(GatewayLog.is_cached == is_cached)
        if error_code:
            conditions.append(GatewayLog.error_code == error_code)

        stmt = select(GatewayLog)
        if conditions:
            stmt = stmt.where(and_(*conditions))

        return stmt.order_by(GatewayLog.created_at.desc(), GatewayLog.id.desc())

    async def get_logs_by_time_range(
        self,
        start_time: datetime,
        end_time: datetime,
        limit: int = 100
    ) -> list[GatewayLog]:
        """
        基于 BRIN 索引的 created_at 范围查询
        """
        result = await self.session.execute(
            select(GatewayLog)
            .where(
                GatewayLog.created_at >= start_time,
                GatewayLog.created_at <= end_time
            )
            .order_by(GatewayLog.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
