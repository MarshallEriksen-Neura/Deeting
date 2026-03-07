from app.protocols.egress import (
    render_chat_completion_response,
    render_responses_api_response,
)
from app.protocols.runtime.response_decoders import (
    decode_anthropic_messages_response,
    decode_openai_chat_response,
    decode_openai_responses_response,
)


def test_decode_openai_chat_response_to_canonical():
    response = decode_openai_chat_response(
        {
            "model": "gpt-5.3-codex",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "hello",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {"name": "search_docs", "arguments": "{}"},
                            }
                        ],
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
    )

    assert response.output_text == "hello"
    assert response.tool_calls[0].name == "search_docs"
    assert response.usage.total_tokens == 15
    assert render_chat_completion_response(response)["choices"][0]["message"]["content"] == "hello"


def test_decode_openai_responses_response_to_canonical():
    response = decode_openai_responses_response(
        {
            "model": "gpt-5.3-codex",
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "hello"}],
                }
            ],
            "usage": {"input_tokens": 10, "output_tokens": 6, "total_tokens": 16},
        }
    )

    assert response.output_text == "hello"
    assert response.usage.output_tokens == 6
    assert render_responses_api_response(response)["output_text"] == "hello"


def test_decode_anthropic_response_to_canonical():
    response = decode_anthropic_messages_response(
        {
            "model": "claude-3-7-sonnet",
            "content": [
                {"type": "text", "text": "hello"},
                {"type": "thinking", "thinking": "reasoning"},
                {"type": "tool_use", "id": "tool_1", "name": "search", "input": {"q": "docs"}},
            ],
            "usage": {"input_tokens": 12, "output_tokens": 9},
            "stop_reason": "end_turn",
        }
    )

    assert response.output_text == "hello"
    assert response.reasoning == "reasoning"
    assert response.tool_calls[0].arguments == {"q": "docs"}
    assert response.usage.total_tokens == 21
