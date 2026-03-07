from app.api.v1.internal.gateway import _build_tool_result_blocks


def test_build_tool_result_blocks_includes_assistant_transition_from_json_string():
    blocks = _build_tool_result_blocks(
        [
            {
                "name": "activate_assistant",
                "tool_call_id": "call_1",
                "success": True,
                "output": '{"action":"activated","assistant_transition":{"action":"activated","assistant_id":"assistant-1","assistant_name":"Expert","reason":"best match"}}',
            }
        ]
    )

    assert any(block.get("type") == "tool_result" for block in blocks)
    transition = next(
        block for block in blocks if block.get("type") == "assistant_transition"
    )
    assert transition["action"] == "activated"
    assert transition["assistantId"] == "assistant-1"
    assert transition["assistantName"] == "Expert"
