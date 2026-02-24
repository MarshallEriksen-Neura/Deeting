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


def test_append_tool_result_blocks_to_assistant_message():
    step = ConversationAppendStep()
    assistant_message = {
        "role": "assistant",
        "content": "done",
        "meta_info": {"blocks": [{"type": "text", "content": "done"}]},
    }
    tool_calls_log = [
        {
            "name": "search_web",
            "tool_call_id": "call_1",
            "success": True,
            "output": "result line 1\nresult line 2",
            "debug": {
                "execution_id": "exec_001",
                "runtime_tool_calls": {"count": 1},
            },
        },
        {
            "name": "fetch_doc",
            "tool_call_id": "call_2",
            "success": False,
            "error": "timeout",
        },
    ]

    step._append_tool_result_blocks(assistant_message, tool_calls_log)

    blocks = (assistant_message.get("meta_info") or {}).get("blocks") or []
    assert blocks[0]["type"] == "text"
    assert blocks[1] == {
        "type": "tool_result",
        "result": "result line 1\nresult line 2",
        "status": "success",
        "callId": "call_1",
        "toolName": "search_web",
        "debug": {
            "execution_id": "exec_001",
            "runtime_tool_calls": {"count": 1},
        },
    }
    assert blocks[2] == {
        "type": "tool_result",
        "result": "timeout",
        "status": "error",
        "callId": "call_2",
        "toolName": "fetch_doc",
    }
