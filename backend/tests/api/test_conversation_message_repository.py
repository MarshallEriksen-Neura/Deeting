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
