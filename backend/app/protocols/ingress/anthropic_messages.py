from __future__ import annotations

from typing import Any

from app.protocols.canonical import (
    CanonicalClientContext,
    CanonicalContentBlock,
    CanonicalMessage,
    CanonicalRequest,
)
from app.schemas.gateway import AnthropicMessagesRequest


def _to_content_blocks(content: str | list[Any]) -> str | list[CanonicalContentBlock]:
    if isinstance(content, str):
        return content

    blocks: list[CanonicalContentBlock] = []
    for block in content:
        if hasattr(block, "model_dump"):
            block = block.model_dump()
        if isinstance(block, str):
            blocks.append(CanonicalContentBlock(type="text", text=block))
        elif isinstance(block, dict):
            block_type = str(block.get("type") or "text")
            blocks.append(
                CanonicalContentBlock(
                    type=block_type,
                    text=block.get("text") if isinstance(block.get("text"), str) else None,
                    data=block,
                )
            )
        else:
            blocks.append(CanonicalContentBlock(type="text", text=str(block)))
    return blocks


def to_canonical_anthropic_request(
    raw: AnthropicMessagesRequest | dict[str, Any],
) -> CanonicalRequest:
    parsed = (
        raw if isinstance(raw, AnthropicMessagesRequest) else AnthropicMessagesRequest(**raw)
    )

    return CanonicalRequest(
        capability="chat",
        model=parsed.model,
        instructions=parsed.system,
        messages=[
            CanonicalMessage(role=message.role, content=_to_content_blocks(message.content))
            for message in parsed.messages
        ],
        temperature=parsed.temperature,
        max_output_tokens=parsed.max_tokens,
        stream=parsed.stream,
        client_context=CanonicalClientContext(
            metadata={"status_stream": parsed.status_stream, "entrypoint": "anthropic_messages"}
        ),
    )
