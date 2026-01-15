from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema, IDSchema, TimestampSchema


class AssistantSummaryVersion(BaseSchema):
    id: UUID
    version: str
    name: str
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    published_at: datetime | None = None


class AssistantSummary(BaseSchema):
    assistant_id: UUID
    owner_user_id: UUID | None = None
    icon_id: str | None = None
    share_slug: str | None = None
    summary: str | None = None
    published_at: datetime | None = None
    current_version_id: UUID | None = None
    install_count: int = 0
    rating_avg: float = 0.0
    rating_count: int = 0
    tags: list[str] = Field(default_factory=list)
    version: AssistantSummaryVersion


class AssistantMarketItem(AssistantSummary):
    installed: bool = False


class AssistantInstallItem(IDSchema, TimestampSchema):
    user_id: UUID
    assistant_id: UUID
    alias: str | None = None
    icon_override: str | None = None
    pinned_version_id: UUID | None = None
    follow_latest: bool = True
    is_enabled: bool = True
    sort_order: int = 0
    assistant: AssistantSummary


class AssistantInstallUpdate(BaseSchema):
    alias: str | None = Field(None, max_length=100)
    icon_override: str | None = Field(None, max_length=255)
    pinned_version_id: UUID | None = None
    follow_latest: bool | None = None
    is_enabled: bool | None = None
    sort_order: int | None = None


class AssistantSubmitReviewRequest(BaseSchema):
    payload: dict | None = None


class AssistantReviewDecisionRequest(BaseSchema):
    reason: str | None = Field(None, max_length=2000)
