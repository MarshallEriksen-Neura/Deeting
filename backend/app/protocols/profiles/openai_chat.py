from __future__ import annotations

from app.protocols.contracts import ProtocolProfile, RuntimeHook


OPENAI_CHAT_PROFILE = ProtocolProfile(
    profile_id="openai-chat",
    provider="openai",
    protocol_family="openai_chat",
    capability="chat",
    transport={"path": "chat/completions"},
    request={"template_engine": "openai_compat", "request_template": {"model": None, "messages": None, "stream": None}},
    response={"decoder": RuntimeHook(name="openai_chat")},
    stream={"stream_decoder": RuntimeHook(name="openai_chat_sse")},
    features={"supports_messages": True, "supports_tools": True, "supports_json_mode": True},
)
