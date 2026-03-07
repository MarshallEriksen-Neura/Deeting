from app.protocols.profiles import (
    ANTHROPIC_MESSAGES_PROFILE,
    BUILTIN_PROTOCOL_PROFILES,
    OPENAI_CHAT_PROFILE,
    OPENAI_RESPONSES_PROFILE,
)


def test_builtin_profiles_are_registered_and_schema_valid():
    assert set(BUILTIN_PROTOCOL_PROFILES) == {
        "openai_chat",
        "openai_responses",
        "anthropic_messages",
    }


def test_openai_chat_profile_exposes_expected_transport_and_features():
    assert OPENAI_CHAT_PROFILE.transport.path == "chat/completions"
    assert OPENAI_CHAT_PROFILE.response.decoder.name == "openai_chat"
    assert OPENAI_CHAT_PROFILE.features.supports_messages is True
    assert OPENAI_CHAT_PROFILE.features.supports_input_items is False


def test_openai_responses_profile_exposes_expected_transport_and_features():
    assert OPENAI_RESPONSES_PROFILE.transport.path == "responses"
    assert OPENAI_RESPONSES_PROFILE.response.decoder.name == "openai_responses"
    assert OPENAI_RESPONSES_PROFILE.stream.stream_decoder.name == "openai_responses_events"
    assert OPENAI_RESPONSES_PROFILE.features.supports_input_items is True
    assert OPENAI_RESPONSES_PROFILE.features.supports_reasoning is True


def test_anthropic_profile_carries_protocol_specific_header():
    assert ANTHROPIC_MESSAGES_PROFILE.transport.header_template["anthropic-version"] == "2023-06-01"
    assert ANTHROPIC_MESSAGES_PROFILE.response.decoder.name == "anthropic_messages"
