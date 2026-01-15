"""
助手市场审核 API (/api/v1/admin/assistant-reviews)
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi_pagination.ext.sqlalchemy import paginate
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user, require_permissions
from app.models import User
from app.repositories import ReviewTaskRepository
from app.schemas import AssistantReviewDecisionRequest, ReviewTaskDTO
from app.services.assistant.assistant_market_service import ASSISTANT_MARKET_ENTITY
from app.services.review.review_service import ReviewService

router = APIRouter(prefix="/admin/assistant-reviews", tags=["Admin - Assistant Reviews"])


def get_review_service(db: AsyncSession = Depends(get_db)) -> ReviewService:
    review_repo = ReviewTaskRepository(db)
    return ReviewService(review_repo)


def get_review_repo(db: AsyncSession = Depends(get_db)) -> ReviewTaskRepository:
    return ReviewTaskRepository(db)


@router.get(
    "",
    response_model=CursorPage[ReviewTaskDTO],
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def list_assistant_reviews(
    params: CursorParams = Depends(),
    status_filter: str | None = Query(None, description="审核状态过滤"),
    repo: ReviewTaskRepository = Depends(get_review_repo),
) -> CursorPage[ReviewTaskDTO]:
    stmt = repo.build_query(entity_type=ASSISTANT_MARKET_ENTITY, status=status_filter)
    return await paginate(repo.session, stmt, params=params)


@router.post(
    "/{assistant_id}/approve",
    response_model=ReviewTaskDTO,
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def approve_assistant_review(
    assistant_id: UUID,
    payload: AssistantReviewDecisionRequest,
    current_user: User = Depends(get_current_user),
    service: ReviewService = Depends(get_review_service),
) -> ReviewTaskDTO:
    try:
        task = await service.approve(
            entity_type=ASSISTANT_MARKET_ENTITY,
            entity_id=assistant_id,
            reviewer_user_id=current_user.id,
            reason=payload.reason,
        )
        return ReviewTaskDTO.model_validate(task)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post(
    "/{assistant_id}/reject",
    response_model=ReviewTaskDTO,
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def reject_assistant_review(
    assistant_id: UUID,
    payload: AssistantReviewDecisionRequest,
    current_user: User = Depends(get_current_user),
    service: ReviewService = Depends(get_review_service),
) -> ReviewTaskDTO:
    try:
        task = await service.reject(
            entity_type=ASSISTANT_MARKET_ENTITY,
            entity_id=assistant_id,
            reviewer_user_id=current_user.id,
            reason=payload.reason,
        )
        return ReviewTaskDTO.model_validate(task)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
