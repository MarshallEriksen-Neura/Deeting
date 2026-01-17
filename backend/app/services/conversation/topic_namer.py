from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.models.conversation import ConversationSession
from app.models.secretary import UserSecretary
from app.prompts.topic_naming import TOPIC_NAMING_PROMPT_TEMPLATE
from app.repositories.provider_instance_repository import ProviderModelRepository
from app.services.providers.provider_instance_service import ProviderInstanceService


TOPIC_NAMING_META_KEY = "topic_naming_scheduled"
TOPIC_TITLE_MAX_LENGTH = 40


def extract_first_user_message(messages: list[dict[str, Any]]) -> str | None:
    for msg in messages:
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        if content is None:
            continue
        text = content if isinstance(content, str) else str(content)
        text = text.strip()
        if text:
            return text
    return None


def _extract_title_from_response(response_body: Any) -> str | None:
    if isinstance(response_body, dict):
        choices = response_body.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                message = first.get("message")
                if isinstance(message, dict):
                    content = message.get("content")
                    if isinstance(content, str) and content.strip():
                        return content
                text = first.get("text")
                if isinstance(text, str) and text.strip():
                    return text
        content = response_body.get("content")
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list) and content:
            first_part = content[0]
            if isinstance(first_part, dict):
                text = first_part.get("text")
                if isinstance(text, str) and text.strip():
                    return text
        completion = response_body.get("completion")
        if isinstance(completion, str) and completion.strip():
            return completion
    if isinstance(response_body, str) and response_body.strip():
        return response_body
    return None


def _sanitize_title(title: str, fallback: str) -> str | None:
    if not title:
        return None
    text = title.strip()
    text = text.replace("\n", " ").replace("\r", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = text.strip("“”\"'`")
    text = text.strip(" -–—·•:：")
    if not text:
        text = fallback.strip()
    if not text:
        return None
    return text[:TOPIC_TITLE_MAX_LENGTH]


async def generate_conversation_title(
    db: AsyncSession,
    *,
    session_id: str,
    user_id: str,
    first_message: str,
) -> str:
    if not session_id or not user_id or not first_message:
        return "invalid_input"

    try:
        session_uuid = uuid.UUID(session_id)
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        return "invalid_uuid"

    session_stmt = select(ConversationSession).where(ConversationSession.id == session_uuid)
    session_result = await db.execute(session_stmt)
    session_obj = session_result.scalar_one_or_none()
    if not session_obj:
        return "session_not_found"
    if session_obj.title:
        return "title_exists"

    secretary_stmt = select(UserSecretary).where(UserSecretary.user_id == user_uuid)
    secretary_result = await db.execute(secretary_stmt)
    secretary = secretary_result.scalar_one_or_none()
    if not secretary or not secretary.topic_naming_model:
        return "skip_unconfigured"

    model_repo = ProviderModelRepository(db)
    candidates = await model_repo.get_candidates(
        capability="chat",
        model_id=secretary.topic_naming_model,
        user_id=str(user_uuid),
        include_public=False,
    )
    if not candidates:
        return "skip_model_unavailable"

    model = candidates[0]
    prompt = TOPIC_NAMING_PROMPT_TEMPLATE.format(first_message=first_message.strip())
    try:
        service = ProviderInstanceService(db)
        response = await service.test_model(
            model_id=model.id,
            user_id=user_uuid,
            prompt=prompt,
        )
    except Exception as exc:
        logger.warning(f"topic_naming_call_failed session={session_id} exc={exc}")
        return "upstream_failed"

    if not isinstance(response, dict) or not response.get("success"):
        return "upstream_failed"

    raw_title = _extract_title_from_response(response.get("response_body"))
    title = _sanitize_title(raw_title or "", fallback=first_message)
    if not title:
        return "empty_title"

    if session_obj.title:
        return "title_exists"

    session_obj.title = title
    await db.commit()
    return "ok"
