from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema


class AssistantRatingRequest(BaseSchema):
    rating: float = Field(..., ge=1, le=5, description="评分（1-5）")


class AssistantRatingResponse(BaseSchema):
    assistant_id: UUID
    rating_avg: float
    rating_count: int
