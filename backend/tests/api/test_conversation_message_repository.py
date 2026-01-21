import uuid

import pytest
from sqlalchemy import func, select

from app.models.conversation import (
    ConversationChannel,
    ConversationMessage,
    ConversationSession,
    ConversationStatus,
)
from app.repositories.conversation_message_repository import ConversationMessageRepository
from app.utils.time_utils import Datetime


@pytest.mark.asyncio
async def test_bulk_insert_messages_dedupes(AsyncSessionLocal):
    session_id = uuid.uuid4()
    async with AsyncSessionLocal() as session:
        session.add(
            ConversationSession(
                id=session_id,
                channel=ConversationChannel.INTERNAL,
                status=ConversationStatus.ACTIVE,
                last_active_at=Datetime.now(),
                message_count=0,
            )
        )
        await session.commit()

    messages = [
        {
            "role": "user",
            "content": "hi",
            "token_estimate": 1,
            "turn_index": 1,
        },
        {
            "role": "assistant",
            "content": "hello",
            "token_estimate": 1,
            "turn_index": 2,
        },
        {
            "role": "assistant",
            "content": "skip",
            "token_estimate": 1,
        },
    ]

    async with AsyncSessionLocal() as session:
        repo = ConversationMessageRepository(session)
        await repo.bulk_insert_messages(session_id=session_id, messages=messages)
        await repo.bulk_insert_messages(session_id=session_id, messages=messages)

        result = await session.execute(
            select(func.count())
            .select_from(ConversationMessage)
            .where(ConversationMessage.session_id == session_id)
        )
        assert result.scalar() == 2


@pytest.mark.asyncio
async def test_bulk_insert_messages_meta_info(AsyncSessionLocal):
    session_id = uuid.uuid4()
    async with AsyncSessionLocal() as session:
        session.add(
            ConversationSession(
                id=session_id,
                channel=ConversationChannel.INTERNAL,
                status=ConversationStatus.ACTIVE,
                last_active_at=Datetime.now(),
                message_count=0,
            )
        )
        await session.commit()

    messages = [
        {
            "role": "user",
            "content": [{"type": "image_url", "image_url": {"url": "https://img"}}],
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "weather", "arguments": "{}"},
                }
            ],
            "token_estimate": 1,
            "turn_index": 1,
        }
    ]

    async with AsyncSessionLocal() as session:
        repo = ConversationMessageRepository(session)
        await repo.bulk_insert_messages(session_id=session_id, messages=messages)
        result = await session.execute(
            select(ConversationMessage).where(
                ConversationMessage.session_id == session_id
            )
        )
        stored = result.scalars().first()
        assert stored is not None
        assert stored.content is None
        assert stored.meta_info is not None
        assert stored.meta_info.get("tool_calls")[0]["id"] == "call_1"
        assert stored.meta_info.get("content")[0]["type"] == "image_url"
