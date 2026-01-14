from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi_pagination import CursorPage
from fastapi_pagination.cursor import CursorParams
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.repositories.gateway_log_repository import GatewayLogRepository
from app.schemas.gateway_log import GatewayLogDTO
from app.services.logs import GatewayLogService

router = APIRouter(prefix="/logs", tags=["Logs"])


def get_gateway_log_service(db: AsyncSession = Depends(get_db)) -> GatewayLogService:
    repo = GatewayLogRepository(db)
    return GatewayLogService(repo)


@router.get("", response_model=CursorPage[GatewayLogDTO])
async def list_gateway_logs(
    params: CursorParams = Depends(),
    start_time: datetime | None = Query(None, description="开始时间，ISO8601"),
    end_time: datetime | None = Query(None, description="结束时间，ISO8601"),
    model: str | None = Query(None, max_length=128, description="按模型名过滤"),
    status_code: int | None = Query(None, description="按状态码过滤"),
    is_cached: bool | None = Query(None, description="是否命中缓存"),
    error_code: str | None = Query(None, max_length=64, description="错误码过滤"),
    current_user: User = Depends(get_current_user),
    service: GatewayLogService = Depends(get_gateway_log_service),
) -> CursorPage[GatewayLogDTO]:
    """
    查询当前用户的网关请求日志，使用游标分页。
    """
    return await service.list_user_logs(
        user_id=current_user.id,
        params=params,
        start_time=start_time,
        end_time=end_time,
        model=model,
        status_code=status_code,
        is_cached=is_cached,
        error_code=error_code,
    )
