from __future__ import annotations

from app.protocols.contracts import ProtocolProfile, RuntimeHook


ANTHROPIC_MESSAGES_PROFILE = ProtocolProfile(
    profile_id="anthropic-messages",
    provider="anthropic",
    protocol_family="anthropic_messages",
    capability="chat",
    transport={
        "path": "messages",
        "header_template": {"anthropic-version": "2023-06-01"},
    },
    request={
        "template_engine": "jinja2",
        "request_template": {
            "model": "{{ request.model }}",
            "system": "{{ request.instructions }}",
            "messages": "{{ request.messages }}",
            "max_tokens": "{{ request.max_output_tokens }}",
            "stream": "{{ request.stream | default(false) }}",
        },
    },
    response={"decoder": RuntimeHook(name="anthropic_messages")},
    features={"supports_messages": True, "supports_tools": True, "supports_reasoning": True},
)
