import uuid

import pytest
from sqlalchemy import select

from app.models.conversation import (
    ConversationChannel,
    ConversationMessage,
    ConversationSession,
    ConversationStatus,
)
from app.repositories.conversation_session_repository import ConversationSessionRepository
from app.utils.time_utils import Datetime


@pytest.mark.asyncio
async def test_reserve_turn_indexes_creates_session(AsyncSessionLocal):
    session_id = uuid.uuid4()
    async with AsyncSessionLocal() as session:
        repo = ConversationSessionRepository(session)
        turns = await repo.reserve_turn_indexes(
            session_id=session_id,
            user_id=None,
            tenant_id=None,
            assistant_id=None,
            channel=ConversationChannel.INTERNAL,
            count=2,
        )
        assert turns == [1, 2]
        stored = await session.get(ConversationSession, session_id)
        assert stored is not None
        assert stored.message_count == 2


@pytest.mark.asyncio
async def test_reserve_turn_indexes_respects_max_turn(AsyncSessionLocal):
    session_id = uuid.uuid4()
    async with AsyncSessionLocal() as session:
        session.add(
            ConversationSession(
                id=session_id,
                channel=ConversationChannel.INTERNAL,
                status=ConversationStatus.ACTIVE,
                last_active_at=Datetime.now(),
                message_count=1,
            )
        )
        session.add(
            ConversationMessage(
                session_id=session_id,
                turn_index=3,
                role="user",
                content="hi",
                token_estimate=1,
            )
        )
        await session.commit()

    async with AsyncSessionLocal() as session:
        repo = ConversationSessionRepository(session)
        turns = await repo.reserve_turn_indexes(
            session_id=session_id,
            user_id=None,
            tenant_id=None,
            assistant_id=None,
            channel=ConversationChannel.INTERNAL,
            count=2,
        )
        assert turns == [4, 5]
        result = await session.execute(
            select(ConversationSession.message_count).where(
                ConversationSession.id == session_id
            )
        )
        assert result.scalar() == 5
