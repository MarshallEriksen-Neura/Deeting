from deeting.protocol import (
    CANONICAL_SCHEMA_VERSION,
    PROTOCOL_FAMILY_OPENAI_RESPONSES,
    canonical_input_item,
    canonical_message,
    canonical_request_from_messages,
    parse_runtime_context,
    render_block_payload,
    tool_call_payload,
)


def test_canonical_request_from_messages_builds_input_items_for_responses():
    request = canonical_request_from_messages(
        model="gpt-5.3-codex",
        protocol_family=PROTOCOL_FAMILY_OPENAI_RESPONSES,
        messages=[
            canonical_message("system", "be concise"),
            canonical_message("user", "hello sdk"),
        ],
        max_output_tokens=128,
    )

    assert request["canonical_version"] == CANONICAL_SCHEMA_VERSION
    assert request["model"] == "gpt-5.3-codex"
    assert request["input_items"][0]["text"] == "hello sdk"
    assert request["max_output_tokens"] == 128


def test_payload_helpers_build_stable_runtime_markers():
    block = render_block_payload("table", payload={"rows": 1}, title="Stats")
    tool = tool_call_payload(2, "search_docs", {"query": "protocol"})
    item = canonical_input_item("text", text="hello")

    assert block["view_type"] == "table"
    assert block["title"] == "Stats"
    assert tool["index"] == 2
    assert tool["tool_name"] == "search_docs"
    assert item["text"] == "hello"


def test_parse_runtime_context_is_safe_on_bad_or_missing_json():
    assert parse_runtime_context("") == {
        "context": {},
        "tool_results": [],
        "max_tool_calls": 8,
    }
    assert parse_runtime_context("not-json") == {
        "context": {},
        "tool_results": [],
        "max_tool_calls": 8,
    }
