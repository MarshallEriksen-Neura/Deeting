from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema


class ConversationSessionItem(BaseSchema):
    session_id: UUID
    title: str | None = None
    summary_text: str | None = None
    message_count: int = 0
    first_message_at: datetime | None = None
    last_active_at: datetime | None = None


class ConversationSessionRenameRequest(BaseSchema):
    title: str = Field(..., min_length=1, max_length=200, description="会话标题")


class ConversationSessionRenameResponse(BaseSchema):
    session_id: UUID
    title: str | None = None


class ConversationSessionCreateRequest(BaseSchema):
    assistant_id: UUID | None = Field(default=None, description="助手 ID（可选）")
    title: str | None = Field(
        default=None, max_length=200, description="会话标题（可选）"
    )


class ConversationSessionCreateResponse(BaseSchema):
    session_id: UUID
    title: str | None = None
