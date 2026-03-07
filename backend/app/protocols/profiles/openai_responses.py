from __future__ import annotations

from app.protocols.contracts import ProtocolProfile, RuntimeHook


OPENAI_RESPONSES_PROFILE = ProtocolProfile(
    profile_id="openai-responses",
    provider="openai",
    protocol_family="openai_responses",
    capability="chat",
    transport={"path": "responses"},
    request={"template_engine": "jinja2", "request_template": {"model": "{{ request.model }}", "input": "{{ input.input_items[0].text if input.input_items else '' }}", "stream": "{{ request.stream | default(false) }}"}},
    response={"decoder": RuntimeHook(name="openai_responses")},
    stream={"stream_decoder": RuntimeHook(name="openai_responses_events")},
    features={"supports_messages": False, "supports_input_items": True, "supports_tools": True, "supports_reasoning": True, "supports_json_mode": True},
)
