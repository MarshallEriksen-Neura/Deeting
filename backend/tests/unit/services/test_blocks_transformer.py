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
