from __future__ import annotations

from typing import Any

from app.protocols.canonical import (
    CanonicalContentBlock,
    CanonicalResponse,
    CanonicalToolCall,
    CanonicalUsage,
)


def decode_response(
    decoder_name: str,
    payload: dict[str, Any],
    *,
    fallback_model: str | None = None,
) -> CanonicalResponse:
    name = (decoder_name or "").strip().lower()
    if name == "openai_responses":
        response = decode_openai_responses_response(payload)
    elif name == "anthropic_messages":
        response = decode_anthropic_messages_response(payload)
    else:
        response = decode_openai_chat_response(payload)

    if fallback_model and not response.model:
        response.model = fallback_model
    return response


def _usage_from_openai(payload: dict[str, Any]) -> CanonicalUsage:
    usage = payload.get("usage") or {}
    return CanonicalUsage(
        input_tokens=int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
        output_tokens=int(
            usage.get("completion_tokens") or usage.get("output_tokens") or 0
        ),
        total_tokens=int(usage.get("total_tokens") or 0),
    )


def decode_openai_chat_response(payload: dict[str, Any]) -> CanonicalResponse:
    choice = (payload.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    content = message.get("content")
    text = content if isinstance(content, str) else None
    return CanonicalResponse(
        model=str(payload.get("model") or ""),
        output_text=text,
        content_blocks=(
            [CanonicalContentBlock(type="text", text=text)] if text else []
        ),
        tool_calls=[
            CanonicalToolCall(
                id=item.get("id"),
                type=item.get("type") or "function",
                name=(item.get("function") or {}).get("name") if isinstance(item, dict) else None,
                arguments=(item.get("function") or {}).get("arguments") if isinstance(item, dict) else None,
            )
            for item in (message.get("tool_calls") or [])
            if isinstance(item, dict)
        ],
        reasoning=message.get("reasoning_content"),
        finish_reason=choice.get("finish_reason"),
        usage=_usage_from_openai(payload),
        raw_response=payload,
    )


def decode_openai_responses_response(payload: dict[str, Any]) -> CanonicalResponse:
    output_text = payload.get("output_text") if isinstance(payload.get("output_text"), str) else None
    blocks: list[CanonicalContentBlock] = []
    tool_calls: list[CanonicalToolCall] = []

    for item in payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "message":
            for content in item.get("content") or []:
                if not isinstance(content, dict):
                    continue
                if content.get("type") in {"output_text", "text"}:
                    text = content.get("text")
                    if isinstance(text, str):
                        output_text = (output_text or "") + text
                        blocks.append(CanonicalContentBlock(type="text", text=text))
        elif item.get("type") in {"function_call", "tool_call"}:
            tool_calls.append(
                CanonicalToolCall(
                    id=item.get("id"),
                    type="function",
                    name=item.get("name"),
                    arguments=item.get("arguments"),
                    status=item.get("status"),
                )
            )

    usage = payload.get("usage") or {}
    return CanonicalResponse(
        model=str(payload.get("model") or ""),
        output_text=output_text,
        content_blocks=blocks,
        tool_calls=tool_calls,
        finish_reason=payload.get("status") or payload.get("finish_reason"),
        usage=CanonicalUsage(
            input_tokens=int(usage.get("input_tokens") or 0),
            output_tokens=int(usage.get("output_tokens") or 0),
            total_tokens=int(usage.get("total_tokens") or 0),
        ),
        raw_response=payload,
    )


def decode_anthropic_messages_response(payload: dict[str, Any]) -> CanonicalResponse:
    text_parts: list[str] = []
    blocks: list[CanonicalContentBlock] = []
    tool_calls: list[CanonicalToolCall] = []
    reasoning_parts: list[str] = []

    for block in payload.get("content") or []:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text":
            text = block.get("text")
            if isinstance(text, str):
                text_parts.append(text)
                blocks.append(CanonicalContentBlock(type="text", text=text))
        elif block_type == "thinking":
            thinking = block.get("thinking")
            if isinstance(thinking, str):
                reasoning_parts.append(thinking)
        elif block_type == "tool_use":
            tool_calls.append(
                CanonicalToolCall(
                    id=block.get("id"),
                    type="function",
                    name=block.get("name"),
                    arguments=block.get("input"),
                )
            )

    usage = payload.get("usage") or {}
    return CanonicalResponse(
        model=str(payload.get("model") or ""),
        output_text="".join(text_parts) or None,
        content_blocks=blocks,
        tool_calls=tool_calls,
        reasoning="".join(reasoning_parts) or None,
        finish_reason=payload.get("stop_reason"),
        usage=CanonicalUsage(
            input_tokens=int(usage.get("input_tokens") or 0),
            output_tokens=int(usage.get("output_tokens") or 0),
            total_tokens=int(
                (usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0)
            ),
        ),
        raw_response=payload,
    )
