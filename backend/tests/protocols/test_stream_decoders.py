from app.protocols.runtime.stream_decoders import (
    decode_openai_chat_sse_chunk,
    decode_openai_responses_event_chunk,
)


def test_decode_openai_chat_sse_chunk():
    events = decode_openai_chat_sse_chunk(
        b'data: {"model":"gpt-5.3-codex","choices":[{"delta":{"content":"hel"}}]}\n'
        b'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"search_docs","arguments":"{}"}}]}}]}\n'
        b'data: {"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n'
        b'data: [DONE]\n'
    )

    assert events[0].type == "text_delta"
    assert events[0].delta_text == "hel"
    assert events[1].type == "tool_call_delta"
    assert events[1].tool_call_delta.name == "search_docs"
    assert events[2].type == "usage"
    assert events[2].usage_delta.total_tokens == 12
    assert events[3].type == "response_finished"


def test_decode_openai_responses_event_chunk():
    events = decode_openai_responses_event_chunk(
        b'data: {"type":"response.output_text.delta","delta":"hel"}\n'
        b'data: {"type":"response.function_call.delta","item_id":"call_1","name":"search_docs","arguments_delta":"{}"}\n'
        b'data: {"type":"response.completed"}\n'
    )

    assert events[0].type == "text_delta"
    assert events[0].delta_text == "hel"
    assert events[1].type == "tool_call_delta"
    assert events[1].tool_call_delta.id == "call_1"
    assert events[2].type == "response_finished"
