from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.schemas.base import BaseSchema


class ConversationSessionItem(BaseSchema):
    session_id: UUID
    title: str | None = None
    summary_text: str | None = None
    message_count: int = 0
    first_message_at: datetime | None = None
    last_active_at: datetime | None = None
