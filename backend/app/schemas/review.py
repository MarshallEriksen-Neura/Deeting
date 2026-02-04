from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.models.review import ReviewStatus
from app.schemas.base import IDSchema, TimestampSchema


class ReviewTaskDTO(IDSchema, TimestampSchema):
    entity_type: str
    entity_id: UUID
    status: ReviewStatus
    submitter_user_id: UUID | None = None
    reviewer_user_id: UUID | None = None
    submitted_at: datetime | None = None
    reviewed_at: datetime | None = None
    reason: str | None = None
    payload: dict = Field(default_factory=dict)
