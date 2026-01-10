from datetime import datetime

from sqlalchemy import select

from app.models.gateway_log import GatewayLog

from .base import BaseRepository


class GatewayLogRepository(BaseRepository[GatewayLog]):
    model = GatewayLog

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
