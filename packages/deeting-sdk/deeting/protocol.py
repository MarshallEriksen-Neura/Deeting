"""
Deeting SDK protocol constants.

Single source of truth: packages/code-mode-contract/contract.json
This module loads the contract at import time and exports the markers/headers
used by both the SDK (Python skill side) and the host (Rust/Python host side).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_CONTRACT_PATH_CANDIDATES = [
    Path(__file__).resolve().parents[2] / "code-mode-contract" / "contract.json",
    Path(__file__).resolve().parents[3] / "packages" / "code-mode-contract" / "contract.json",
]


def _load_contract() -> dict[str, Any]:
    for candidate in _CONTRACT_PATH_CANDIDATES:
        if candidate.exists():
            try:
                return json.loads(candidate.read_text(encoding="utf-8"))
            except Exception:
                pass
    return {}


_CONTRACT = _load_contract()
_MARKERS: dict[str, Any] = _CONTRACT.get("markers") if isinstance(_CONTRACT.get("markers"), dict) else {}
_HEADERS: dict[str, Any] = _CONTRACT.get("headers") if isinstance(_CONTRACT.get("headers"), dict) else {}

RUNTIME_PROTOCOL_VERSION: str = str(_CONTRACT.get("runtime_protocol_version") or "v1")
CANONICAL_SCHEMA_VERSION: str = "2026-03-07"

PROTOCOL_FAMILY_OPENAI_CHAT = "openai_chat"
PROTOCOL_FAMILY_OPENAI_RESPONSES = "openai_responses"

TOOL_CALL_MARKER: str = str(
    _MARKERS.get("runtime_tool_call") or "__DEETING_TOOL_CALL_REQUEST__"
)
RENDER_BLOCK_MARKER: str = str(
    _MARKERS.get("runtime_render_block") or "__DEETING_RENDER_BLOCK__"
)
EXECUTION_TOKEN_HEADER: str = str(
    _HEADERS.get("execution_token") or "X-Code-Mode-Execution-Token"
)


def canonical_message(role: str, content: Any) -> dict[str, Any]:
    return {
        "role": str(role or "").strip() or "user",
        "content": content,
    }


def canonical_input_item(
    item_type: str,
    *,
    text: str | None = None,
    role: str | None = "user",
    mime_type: str | None = None,
    url: str | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "type": str(item_type or "").strip() or "text",
        "role": role,
        "text": text,
        "mime_type": mime_type,
        "url": url,
        "data": data or {},
    }


def canonical_request_from_messages(
    *,
    model: str,
    messages: list[dict[str, Any]],
    protocol_family: str = PROTOCOL_FAMILY_OPENAI_CHAT,
    stream: bool = False,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
) -> dict[str, Any]:
    request: dict[str, Any] = {
        "canonical_version": CANONICAL_SCHEMA_VERSION,
        "capability": "chat",
        "model": model,
        "messages": messages,
        "input_items": [],
        "stream": bool(stream),
        "metadata": {},
        "client_context": {"channel": "sdk"},
    }
    if temperature is not None:
        request["temperature"] = temperature
    if max_output_tokens is not None:
        request["max_output_tokens"] = int(max_output_tokens)

    if protocol_family == PROTOCOL_FAMILY_OPENAI_RESPONSES:
        text_parts: list[str] = []
        for message in messages:
            if str(message.get("role") or "").strip().lower() == "system":
                continue
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                text_parts.append(content)
        if text_parts:
            request["input_items"] = [
                canonical_input_item("text", text="\n\n".join(text_parts))
            ]
    return request


def tool_call_payload(index: int, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return {
        "index": int(index),
        "tool_name": str(tool_name or "").strip(),
        "arguments": arguments or {},
    }


def render_block_payload(
    view_type: str,
    *,
    payload: dict[str, Any] | None = None,
    title: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    block: dict[str, Any] = {
        "view_type": str(view_type or "").strip(),
        "payload": payload or {},
    }
    if title is not None:
        block["title"] = title
    if metadata is not None:
        block["metadata"] = metadata
    return block


def parse_runtime_context(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {"context": {}, "tool_results": [], "max_tool_calls": 8}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {"context": {}, "tool_results": [], "max_tool_calls": 8}
    if not isinstance(parsed, dict):
        return {"context": {}, "tool_results": [], "max_tool_calls": 8}
    return {
        "context": parsed.get("context") if isinstance(parsed.get("context"), dict) else {},
        "tool_results": parsed.get("tool_results") if isinstance(parsed.get("tool_results"), list) else [],
        "max_tool_calls": int(parsed.get("max_tool_calls") or 8),
    }
