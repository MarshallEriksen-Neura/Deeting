from __future__ import annotations

from typing import Any

from app.protocols.canonical import CanonicalClientContext, CanonicalInputItem, CanonicalRequest
from app.schemas.gateway import ResponsesRequest


def _to_input_items(payload: str | list | dict) -> list[CanonicalInputItem]:
    if isinstance(payload, str):
        return [CanonicalInputItem(type="input_text", role="user", text=payload)]
    if isinstance(payload, dict):
        return [CanonicalInputItem(type="input_json", role="user", data=payload)]

    items: list[CanonicalInputItem] = []
    for value in payload:
        if isinstance(value, str):
            items.append(CanonicalInputItem(type="input_text", role="user", text=value))
        elif isinstance(value, dict):
            item_type = str(value.get("type") or "input_json")
            items.append(
                CanonicalInputItem(
                    type=item_type,
                    role=value.get("role") if isinstance(value.get("role"), str) else "user",
                    text=value.get("text") if isinstance(value.get("text"), str) else None,
                    mime_type=value.get("mime_type") if isinstance(value.get("mime_type"), str) else None,
                    url=value.get("url") if isinstance(value.get("url"), str) else None,
                    data=value,
                )
            )
        else:
            items.append(CanonicalInputItem(type="input_text", role="user", text=str(value)))
    return items


def to_canonical_responses_request(raw: ResponsesRequest | dict[str, Any]) -> CanonicalRequest:
    parsed = raw if isinstance(raw, ResponsesRequest) else ResponsesRequest(**raw)

    return CanonicalRequest(
        capability="chat",
        model=parsed.model,
        instructions=parsed.system,
        input_items=_to_input_items(parsed.input),
        temperature=parsed.temperature,
        max_output_tokens=parsed.max_tokens,
        stream=parsed.stream,
        client_context=CanonicalClientContext(
            metadata={"status_stream": parsed.status_stream, "entrypoint": "responses"}
        ),
    )
