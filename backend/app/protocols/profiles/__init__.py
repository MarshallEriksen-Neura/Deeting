from app.protocols.profiles.anthropic_messages import ANTHROPIC_MESSAGES_PROFILE
from app.protocols.profiles.openai_chat import OPENAI_CHAT_PROFILE
from app.protocols.profiles.openai_responses import OPENAI_RESPONSES_PROFILE

BUILTIN_PROTOCOL_PROFILES = {
    OPENAI_CHAT_PROFILE.protocol_family: OPENAI_CHAT_PROFILE,
    OPENAI_RESPONSES_PROFILE.protocol_family: OPENAI_RESPONSES_PROFILE,
    ANTHROPIC_MESSAGES_PROFILE.protocol_family: ANTHROPIC_MESSAGES_PROFILE,
}

__all__ = [
    "ANTHROPIC_MESSAGES_PROFILE",
    "BUILTIN_PROTOCOL_PROFILES",
    "OPENAI_CHAT_PROFILE",
    "OPENAI_RESPONSES_PROFILE",
]
