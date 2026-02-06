from app.services.providers.blocks_transformer import build_blocks_from_message


def test_build_blocks_from_message_reasoning_and_text():
    blocks = build_blocks_from_message(
        content="hello",
        reasoning="think",
        tool_calls=None,
    )
    assert blocks == [
        {"type": "thought", "content": "think"},
        {"type": "text", "content": "hello"},
    ]


def test_build_blocks_from_message_does_not_parse_legacy_think_tag():
    blocks = build_blocks_from_message(
        content="<think>hidden</think>answer",
        reasoning=None,
        tool_calls=None,
    )
    assert blocks == [
        {"type": "text", "content": "<think>hidden</think>answer"},
    ]


def test_build_blocks_from_message_tool_call_contains_call_id():
    blocks = build_blocks_from_message(
        content=None,
        reasoning=None,
        tool_calls=[
            {
                "id": "call_123",
                "function": {"name": "search_web", "arguments": {"q": "abc"}},
            }
        ],
    )
    assert blocks == [
        {
            "type": "tool_call",
            "toolName": "search_web",
            "toolArgs": '{"q": "abc"}',
            "callId": "call_123",
        }
    ]
