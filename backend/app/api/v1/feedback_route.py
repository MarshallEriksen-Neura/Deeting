from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.schemas.feedback import TraceFeedbackRequest, TraceFeedbackResponse
from app.services.feedback.trace_feedback_service import TraceFeedbackService

router = APIRouter(prefix="/feedback", tags=["Feedback"])


def get_feedback_service(db: AsyncSession = Depends(get_db)) -> TraceFeedbackService:
    return TraceFeedbackService(db)


@router.post("", response_model=TraceFeedbackResponse)
async def create_feedback(
    payload: TraceFeedbackRequest,
    current_user: User = Depends(get_current_user),
    service: TraceFeedbackService = Depends(get_feedback_service),
) -> TraceFeedbackResponse:
    feedback = await service.create_feedback(
        trace_id=payload.trace_id,
        user_id=current_user.id if current_user else None,
        score=payload.score,
        comment=payload.comment,
        tags=payload.tags,
    )
    return feedback


__all__ = ["router"]
