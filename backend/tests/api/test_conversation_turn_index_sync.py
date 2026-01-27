import pytest
from uuid import uuid4

from sqlalchemy import func, select

from app.models.conversation import (
    ConversationChannel,
    ConversationMessage,
    ConversationSession,
    ConversationStatus,
)
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.conversation_append import ConversationAppendStep
from app.utils.time_utils import Datetime


@pytest.mark.asyncio
async def test_conversation_append_syncs_turn_index(AsyncSessionLocal):
    async with AsyncSessionLocal() as session:
        session_id = uuid4()
        user_id = uuid4()
        assistant_id = uuid4()
        now = Datetime.now()

        session.add(
            ConversationSession(
                id=session_id,
                user_id=user_id,
                assistant_id=assistant_id,
                channel=ConversationChannel.INTERNAL,
                status=ConversationStatus.ACTIVE,
                message_count=2,
                first_message_at=now,
                last_active_at=now,
            )
        )
        session.add_all(
            [
                ConversationMessage(
                    id=uuid4(),
                    session_id=session_id,
                    turn_index=1,
                    role="user",
                    content="hi",
                    token_estimate=1,
                    is_truncated=False,
                    is_deleted=False,
                ),
                ConversationMessage(
                    id=uuid4(),
                    session_id=session_id,
                    turn_index=2,
                    role="assistant",
                    content="hello",
                    token_estimate=1,
                    is_truncated=False,
                    is_deleted=False,
                ),
            ]
        )
        await session.commit()

        ctx = WorkflowContext(
            channel=Channel.INTERNAL,
            capability="chat",
            requested_model="test-model",
            db_session=session,
            user_id=str(user_id),
            tenant_id=str(user_id),
        )
        ctx.set("conversation", "session_id", str(session_id))
        ctx.set(
            "validation",
            "validated",
            {
                "messages": [{"role": "user", "content": "next message"}],
                "assistant_id": str(assistant_id),
                "session_id": str(session_id),
            },
        )
        ctx.set(
            "response_transform",
            "response",
            {
                "choices": [
                    {"message": {"role": "assistant", "content": "next reply"}}
                ]
            },
        )

        step = ConversationAppendStep()
        await step.execute(ctx)

        max_turn_result = await session.execute(
            select(func.max(ConversationMessage.turn_index)).where(
                ConversationMessage.session_id == session_id
            )
        )
        assert int(max_turn_result.scalar() or 0) == 4

        count_result = await session.execute(
            select(func.count()).select_from(ConversationMessage).where(
                ConversationMessage.session_id == session_id
            )
        )
        assert int(count_result.scalar() or 0) == 4
