from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi_pagination.ext.sqlalchemy import paginate

from app.repositories.gateway_log_repository import GatewayLogRepository
from app.schemas.gateway_log import GatewayLogDTO


class GatewayLogService:
    def __init__(self, repo: GatewayLogRepository) -> None:
        self.repo = repo

    async def list_user_logs(
        self,
        *,
        user_id: UUID,
        params: CursorParams,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        model: str | None = None,
        status_code: int | None = None,
        is_cached: bool | None = None,
        error_code: str | None = None,
    ) -> CursorPage[GatewayLogDTO]:
        stmt = self.repo.build_query(
            user_id=user_id,
            start_time=start_time,
            end_time=end_time,
            model=model,
            status_code=status_code,
            is_cached=is_cached,
            error_code=error_code,
        )

        async def _transform(rows):
            return [GatewayLogDTO.model_validate(row) for row in rows]

        return await paginate(
            self.repo.session, stmt, params=params, transformer=_transform
        )
