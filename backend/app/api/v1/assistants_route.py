"""
用户侧助手市场与安装 API
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi_pagination.cursor import CursorPage, CursorParams
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.repositories import (
    AssistantRepository,
    AssistantVersionRepository,
    AssistantInstallRepository,
    AssistantMarketRepository,
    ReviewTaskRepository,
)
from app.schemas import (
    AssistantCreate,
    AssistantDTO,
    AssistantInstallItem,
    AssistantInstallUpdate,
    AssistantListResponse,
    AssistantMarketItem,
    AssistantSubmitReviewRequest,
    AssistantUpdate,
    MessageResponse,
)
from app.services.assistant.assistant_market_service import AssistantMarketService
from app.services.assistant.assistant_service import AssistantService

router = APIRouter(prefix="/assistants", tags=["Assistants"])


def get_assistant_service(db: AsyncSession = Depends(get_db)) -> AssistantService:
    assistant_repo = AssistantRepository(db)
    version_repo = AssistantVersionRepository(db)
    return AssistantService(assistant_repo, version_repo)


def get_market_service(db: AsyncSession = Depends(get_db)) -> AssistantMarketService:
    assistant_repo = AssistantRepository(db)
    install_repo = AssistantInstallRepository(db)
    review_repo = ReviewTaskRepository(db)
    market_repo = AssistantMarketRepository(db)
    return AssistantMarketService(assistant_repo, install_repo, review_repo, market_repo)


@router.get("/market", response_model=CursorPage[AssistantMarketItem])
async def list_market_assistants(
    params: CursorParams = Depends(),
    q: str | None = Query(None, description="搜索关键词"),
    tags: list[str] | None = Query(None, description="标签过滤，?tags=a&tags=b"),
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> CursorPage[AssistantMarketItem]:
    return await service.list_market(user_id=current_user.id, params=params, query=q, tags=tags)


@router.get("/installs", response_model=CursorPage[AssistantInstallItem])
async def list_installed_assistants(
    params: CursorParams = Depends(),
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> CursorPage[AssistantInstallItem]:
    return await service.list_installs(user_id=current_user.id, params=params)


@router.post("/{assistant_id}/install", response_model=AssistantInstallItem)
async def install_assistant(
    assistant_id: UUID,
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> AssistantInstallItem:
    try:
        return await service.install_assistant(user_id=current_user.id, assistant_id=assistant_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.delete("/{assistant_id}/install", response_model=MessageResponse)
async def uninstall_assistant(
    assistant_id: UUID,
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> MessageResponse:
    await service.uninstall_assistant(user_id=current_user.id, assistant_id=assistant_id)
    return MessageResponse(message="assistant uninstalled")


@router.patch("/{assistant_id}/install", response_model=AssistantInstallItem)
async def update_installed_assistant(
    assistant_id: UUID,
    payload: AssistantInstallUpdate,
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> AssistantInstallItem:
    try:
        return await service.update_install(
            user_id=current_user.id,
            assistant_id=assistant_id,
            payload=payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("", response_model=AssistantDTO)
async def create_custom_assistant(
    payload: AssistantCreate,
    current_user: User = Depends(get_current_user),
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantDTO:
    try:
        assistant = await service.create_assistant(payload=payload, owner_user_id=current_user.id)
        assistant = await service.assistant_repo.get_with_versions(assistant.id)
        return AssistantDTO.model_validate(assistant)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.patch("/{assistant_id}", response_model=AssistantDTO)
async def update_custom_assistant(
    assistant_id: UUID,
    payload: AssistantUpdate,
    current_user: User = Depends(get_current_user),
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantDTO:
    assistant = await service.assistant_repo.get(assistant_id)
    if not assistant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="assistant not found")
    if assistant.owner_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="permission denied")
    try:
        assistant = await service.update_assistant(assistant_id, payload)
        assistant = await service.assistant_repo.get_with_versions(assistant.id)
        return AssistantDTO.model_validate(assistant)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/owned", response_model=AssistantListResponse)
async def list_owned_assistants(
    cursor: str | None = None,
    size: int = 20,
    current_user: User = Depends(get_current_user),
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantListResponse:
    size = max(1, min(size, 50))
    return await service.list_assistants(
        size=size,
        cursor=cursor,
        owner_user_id=current_user.id,
    )


@router.post("/{assistant_id}/submit", response_model=MessageResponse)
async def submit_assistant_for_review(
    assistant_id: UUID,
    payload: AssistantSubmitReviewRequest,
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> MessageResponse:
    try:
        await service.submit_for_review(
            user_id=current_user.id,
            assistant_id=assistant_id,
            payload=payload.payload,
        )
        return MessageResponse(message="assistant submitted for review")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
