"""
助手管理 API (/api/v1/admin/assistants)

端点:
- POST   /admin/assistants           创建助手（含首个版本）
- PATCH  /admin/assistants/{id}      更新可见性/状态/当前版本等
- POST   /admin/assistants/{id}/publish  发布助手，可选切换版本

路由瘦身：仅做校验、鉴权、依赖注入；业务逻辑封装在 AssistantService。
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user, require_permissions
from app.models import User
from app.repositories import AssistantRepository, AssistantVersionRepository
from app.schemas.assistant import (
    AssistantCreate,
    AssistantDTO,
    AssistantPublishRequest,
    AssistantUpdate,
    AssistantListResponse,
)
from app.services.assistant_service import AssistantService

router = APIRouter(prefix="/admin/assistants", tags=["Admin - Assistants"])


# ===== 依赖注入 =====
def get_assistant_service(db: AsyncSession = Depends(get_db)) -> AssistantService:
    assistant_repo = AssistantRepository(db)
    version_repo = AssistantVersionRepository(db)
    return AssistantService(assistant_repo, version_repo)


# ===== 路由 =====
@router.post(
    "",
    response_model=AssistantDTO,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def create_assistant(
    payload: AssistantCreate,
    current_user: User = Depends(get_current_user),
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantDTO:
    try:
        assistant = await service.create_assistant(
            payload=payload,
            owner_user_id=current_user.id,
        )
        # 带版本加载
        assistant = await service.assistant_repo.get_with_versions(assistant.id)
        return AssistantDTO.model_validate(assistant)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get(
    "",
    response_model=AssistantListResponse,
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def list_assistants(
    cursor: str | None = None,
    size: int = 20,
    status: str | None = None,
    visibility: str | None = None,
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantListResponse:
    """
    游标分页列出助手（按创建时间倒序）。

    - cursor: 上一页返回的 next_cursor
    - size: 每页数量，建议 10-50
    """
    size = max(1, min(size, 50))
    try:
        return await service.list_assistants(
            size=size,
            cursor=cursor,
            status=status,
            visibility=visibility,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get(
    "/search",
    response_model=AssistantListResponse,
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def search_assistants(
    q: str,
    cursor: str | None = None,
    size: int = 20,
    tags: list[str] | None = Query(None, description="可选标签过滤，?tags=a&tags=b"),
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantListResponse:
    """
    全文检索助手（仅公开且已发布），游标分页。
    使用 Postgres tsvector 优先，其他方言回退 ILIKE。
    """
    size = max(1, min(size, 50))
    try:
        return await service.search_public(
            query=q,
            size=size,
            cursor=cursor,
            tags=tags,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch(
    "/{assistant_id}",
    response_model=AssistantDTO,
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def update_assistant(
    assistant_id: UUID,
    payload: AssistantUpdate,
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantDTO:
    try:
        assistant = await service.update_assistant(assistant_id, payload)
        assistant = await service.assistant_repo.get_with_versions(assistant.id)
        return AssistantDTO.model_validate(assistant)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post(
    "/{assistant_id}/publish",
    response_model=AssistantDTO,
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def publish_assistant(
    assistant_id: UUID,
    payload: AssistantPublishRequest,
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantDTO:
    try:
        assistant = await service.publish_assistant(
            assistant_id=assistant_id,
            version_id=payload.version_id,
        )
        assistant = await service.assistant_repo.get_with_versions(assistant.id)
        return AssistantDTO.model_validate(assistant)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
