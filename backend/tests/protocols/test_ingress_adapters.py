from app.protocols.ingress import (
    to_canonical_anthropic_request,
    to_canonical_chat_request,
    to_canonical_responses_request,
)
from app.schemas.gateway import ResponsesRequest


def test_chat_completions_ingress_normalizes_system_and_metadata():
    request = to_canonical_chat_request(
        {
            "model": "gpt-5.3-codex",
            "messages": [
                {"role": "system", "content": "follow policy"},
                {"role": "user", "content": "hello"},
            ],
            "max_output_tokens": 256,
            "request_id": "req-1",
            "session_id": "sess-1",
            "stream": True,
        }
    )

    assert request.instructions == "follow policy"
    assert request.messages[1].content == "hello"
    assert request.max_output_tokens == 256
    assert request.stream is True
    assert request.client_context.request_id == "req-1"
    assert request.client_context.session_id == "sess-1"


def test_responses_ingress_normalizes_input_items_and_aliases():
    parsed = ResponsesRequest(
        model="gpt-5.3-codex",
        input=["hello", {"type": "input_image", "url": "https://example.com/image.png"}],
        system="be brief",
        max_output_tokens=128,
    )

    request = to_canonical_responses_request(parsed)

    assert request.instructions == "be brief"
    assert request.max_output_tokens == 128
    assert request.input_items[0].type == "input_text"
    assert request.input_items[0].text == "hello"
    assert request.input_items[1].type == "input_image"
    assert request.input_items[1].url == "https://example.com/image.png"


def test_anthropic_ingress_converts_content_blocks():
    request = to_canonical_anthropic_request(
        {
            "model": "claude-3-7-sonnet",
            "system": "follow policy",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "hello"},
                        {"type": "image", "source": {"type": "base64", "media_type": "image/png"}},
                    ],
                }
            ],
            "max_output_tokens": 300,
        }
    )

    assert request.instructions == "follow policy"
    assert request.max_output_tokens == 300
    assert isinstance(request.messages[0].content, list)
    assert request.messages[0].content[0].type == "text"
    assert request.messages[0].content[1].type == "image"
    assert request.messages[0].content[1].data["source"]["type"] == "base64"


def test_responses_request_schema_accepts_max_output_tokens_alias():
    parsed = ResponsesRequest(
        model="gpt-5.3-codex",
        input="hi",
        max_output_tokens=42,
    )

    assert parsed.max_tokens == 42
