from __future__ import annotations

import json
from typing import Any

from app.protocols.canonical import CanonicalStreamEvent, CanonicalToolCall, CanonicalUsage


def decode_openai_chat_sse_chunk(chunk: bytes) -> list[CanonicalStreamEvent]:
    events: list[CanonicalStreamEvent] = []
    for line in chunk.decode("utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        if line == "data: [DONE]":
            events.append(CanonicalStreamEvent(type="response_finished"))
            continue
        if not line.startswith("data: "):
            continue
        payload = json.loads(line[6:])
        choice = (payload.get("choices") or [{}])[0]
        delta = choice.get("delta") or choice.get("message") or {}
        if isinstance(delta.get("content"), str):
            events.append(
                CanonicalStreamEvent(
                    type="text_delta",
                    model=payload.get("model"),
                    delta_text=delta.get("content"),
                    raw_event=payload,
                )
            )
        for tool in delta.get("tool_calls") or []:
            if not isinstance(tool, dict):
                continue
            events.append(
                CanonicalStreamEvent(
                    type="tool_call_delta",
                    model=payload.get("model"),
                    tool_call_delta=CanonicalToolCall(
                        id=tool.get("id"),
                        type=tool.get("type") or "function",
                        name=(tool.get("function") or {}).get("name") if isinstance(tool.get("function"), dict) else None,
                        arguments=(tool.get("function") or {}).get("arguments") if isinstance(tool.get("function"), dict) else None,
                    ),
                    raw_event=payload,
                )
            )
        if payload.get("usage"):
            usage = payload["usage"]
            events.append(
                CanonicalStreamEvent(
                    type="usage",
                    model=payload.get("model"),
                    usage_delta=CanonicalUsage(
                        input_tokens=int(usage.get("prompt_tokens") or 0),
                        output_tokens=int(usage.get("completion_tokens") or 0),
                        total_tokens=int(usage.get("total_tokens") or 0),
                    ),
                    raw_event=payload,
                )
            )
    return events


def decode_openai_responses_event_chunk(chunk: bytes) -> list[CanonicalStreamEvent]:
    events: list[CanonicalStreamEvent] = []
    for line in chunk.decode("utf-8").splitlines():
        line = line.strip()
        if not line or not line.startswith("data: "):
            continue
        payload = json.loads(line[6:])
        event_type = payload.get("type")
        if event_type == "response.output_text.delta":
            events.append(
                CanonicalStreamEvent(
                    type="text_delta",
                    model=payload.get("response", {}).get("model") if isinstance(payload.get("response"), dict) else None,
                    delta_text=payload.get("delta"),
                    raw_event=payload,
                )
            )
        elif event_type == "response.function_call.delta":
            events.append(
                CanonicalStreamEvent(
                    type="tool_call_delta",
                    tool_call_delta=CanonicalToolCall(
                        id=payload.get("item_id"),
                        type="function",
                        name=payload.get("name"),
                        arguments=payload.get("arguments_delta"),
                    ),
                    raw_event=payload,
                )
            )
        elif event_type == "response.completed":
            events.append(CanonicalStreamEvent(type="response_finished", raw_event=payload))
    return events
