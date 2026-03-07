from __future__ import annotations

from typing import Any

from app.protocols.canonical import CanonicalClientContext, CanonicalMessage, CanonicalRequest
from app.schemas.gateway import ChatCompletionRequest


def to_canonical_chat_request(raw: ChatCompletionRequest | dict[str, Any]) -> CanonicalRequest:
    parsed = raw if isinstance(raw, ChatCompletionRequest) else ChatCompletionRequest(**raw)

    instructions = "\n\n".join(
        str(message.content)
        for message in parsed.messages
        if message.role == "system" and message.content is not None
    ) or None

    return CanonicalRequest(
        capability="chat",
        model=parsed.model,
        provider_model_id=parsed.provider_model_id,
        instructions=instructions,
        messages=[
            CanonicalMessage(
                role=message.role,
                content=message.content,
                reasoning=message.reasoning_content,
                tool_calls=message.tool_calls or [],
                tool_call_id=message.tool_call_id,
            )
            for message in parsed.messages
        ],
        temperature=parsed.temperature,
        max_output_tokens=parsed.max_tokens,
        stream=parsed.stream,
        client_context=CanonicalClientContext(
            request_id=parsed.request_id,
            session_id=parsed.session_id,
            assistant_id=parsed.assistant_id,
            metadata={"regenerate": parsed.regenerate},
        ),
    )
