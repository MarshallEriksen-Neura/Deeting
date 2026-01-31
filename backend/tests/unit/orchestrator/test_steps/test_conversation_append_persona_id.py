import pytest

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.conversation_append import ConversationAppendStep


@pytest.mark.asyncio
async def test_used_persona_id_prefers_assistant_id():
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set("assistant", "id", "assistant-primary")
    ctx.set(
        "assistant",
        "candidates",
        [
            {"assistant_id": "assistant-secondary"},
        ],
    )

    step = ConversationAppendStep()
    used_persona_id = step._resolve_used_persona_id(ctx)
    assert used_persona_id == "assistant-primary"

    db_messages, _ = step._prepare_messages(
        user_messages=[],
        assistant_message={"role": "assistant", "content": "hello"},
        used_persona_id=used_persona_id,
    )
    assert db_messages[0]["used_persona_id"] == "assistant-primary"


@pytest.mark.asyncio
async def test_used_persona_id_falls_back_to_candidate():
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set(
        "assistant",
        "candidates",
        [
            {"assistant_id": "assistant-candidate"},
        ],
    )

    step = ConversationAppendStep()
    used_persona_id = step._resolve_used_persona_id(ctx)
    assert used_persona_id == "assistant-candidate"

    db_messages, _ = step._prepare_messages(
        user_messages=[],
        assistant_message={"role": "assistant", "content": "hello"},
        used_persona_id=used_persona_id,
    )
    assert db_messages[0]["used_persona_id"] == "assistant-candidate"
