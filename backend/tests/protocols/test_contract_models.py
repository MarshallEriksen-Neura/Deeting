from app.protocols.canonical import (
    CanonicalContentBlock,
    CanonicalRequest,
    CanonicalResponse,
    CanonicalStreamEvent,
    CanonicalToolDefinition,
    CanonicalToolFunction,
)
from app.protocols.contracts import (
    CANONICAL_SCHEMA_VERSION,
    PROTOCOL_PROFILE_SCHEMA_VERSION,
    PROVIDER_PROTOCOL_RUNTIME_VERSION,
    ProtocolProfile,
    RuntimeHook,
)


def test_canonical_request_defaults_are_safe():
    request = CanonicalRequest(model="gpt-5.3-codex")

    assert request.canonical_version == CANONICAL_SCHEMA_VERSION
    assert request.capability == "chat"
    assert request.messages == []
    assert request.input_items == []
    assert request.tools == []
    assert request.stream is False
    assert request.client_context.channel == "internal"


def test_canonical_request_accepts_tools_and_blocks():
    request = CanonicalRequest(
        model="gpt-5.3-codex",
        instructions="be helpful",
        tools=[
            CanonicalToolDefinition(
                function=CanonicalToolFunction(
                    name="search_docs",
                    parameters={"type": "object"},
                )
            )
        ],
        input_items=[CanonicalContentBlock(type="text", text="hello")],
    )

    assert request.instructions == "be helpful"
    assert request.tools[0].function.name == "search_docs"
    assert request.input_items[0].type == "text"


def test_canonical_response_and_stream_event_keep_version_markers():
    response = CanonicalResponse(model="gpt-5.3-codex", output_text="done")
    event = CanonicalStreamEvent(type="text_delta", delta_text="hi", sequence=1)

    assert response.canonical_version == CANONICAL_SCHEMA_VERSION
    assert response.usage.total_tokens == 0
    assert event.canonical_version == CANONICAL_SCHEMA_VERSION
    assert event.type == "text_delta"
    assert event.delta_text == "hi"


def test_protocol_profile_has_runtime_and_schema_versions():
    profile = ProtocolProfile(
        profile_id="openai-chat",
        provider="openai",
        protocol_family="openai_chat",
        capability="chat",
        transport={"path": "chat/completions"},
        request={"request_template": {"model": None, "messages": None}},
        response={"decoder": RuntimeHook(name="openai_chat")},
    )

    assert profile.runtime_version == PROVIDER_PROTOCOL_RUNTIME_VERSION
    assert profile.schema_version == PROTOCOL_PROFILE_SCHEMA_VERSION
    assert profile.transport.method == "POST"
    assert profile.request.template_engine == "openai_compat"
    assert profile.response.decoder.name == "openai_chat"
    assert profile.features.supports_messages is True
    assert profile.features.supports_input_items is False
