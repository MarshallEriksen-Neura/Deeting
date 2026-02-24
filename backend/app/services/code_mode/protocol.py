from __future__ import annotations

import json
from typing import Any

RUNTIME_PROTOCOL_VERSION = "v1"
SDK_TOOLCARD_FORMAT_VERSION = "sdk_toolcard.v2"
EXECUTION_FORMAT_VERSION = f"code_mode.{RUNTIME_PROTOCOL_VERSION}"

RUNTIME_TOOL_CALL_MARKER = "__DEETING_TOOL_CALL_REQUEST__"
RUNTIME_RENDER_BLOCK_MARKER = "__DEETING_RENDER_BLOCK__"

_RUNTIME_SIGNAL_KEYS = ("stdout", "stderr", "result")


def join_chunks(value: Any) -> str:
    if isinstance(value, list):
        return "\n".join(str(item) for item in value)
    if value is None:
        return ""
    return str(value)


def extract_runtime_tool_request(result: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(result, dict):
        return None
    for key in _RUNTIME_SIGNAL_KEYS:
        payload = extract_runtime_tool_request_from_text(join_chunks(result.get(key)))
        if payload is not None:
            return payload
    return None


def extract_runtime_tool_request_from_text(text: str | None) -> dict[str, Any] | None:
    if not text:
        return None
    for line in reversed(str(text).splitlines()):
        raw = line.strip()
        if not raw.startswith(RUNTIME_TOOL_CALL_MARKER):
            continue
        payload_str = raw[len(RUNTIME_TOOL_CALL_MARKER) :].strip()
        if not payload_str:
            return {}
        try:
            payload = json.loads(payload_str)
        except Exception:
            return {}
        if isinstance(payload, dict):
            return payload
        return {}
    return None


def extract_runtime_render_payloads(result: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(result, dict):
        return []
    payloads: list[dict[str, Any]] = []
    for key in _RUNTIME_SIGNAL_KEYS:
        payloads.extend(extract_runtime_render_payloads_from_text(join_chunks(result.get(key))))
    return payloads


def extract_runtime_render_payloads_from_text(text: str | None) -> list[dict[str, Any]]:
    if not text:
        return []

    payloads: list[dict[str, Any]] = []
    for line in str(text).splitlines():
        raw = line.strip()
        if not raw.startswith(RUNTIME_RENDER_BLOCK_MARKER):
            continue
        payload_str = raw[len(RUNTIME_RENDER_BLOCK_MARKER) :].strip()
        if not payload_str:
            continue
        try:
            payload = json.loads(payload_str)
        except Exception:
            continue
        if isinstance(payload, dict):
            payloads.append(payload)
    return payloads


def strip_runtime_signal_lines(text: str | None) -> str:
    if not text:
        return ""
    lines: list[str] = []
    for raw in str(text).splitlines():
        line = raw.strip()
        if line.startswith(RUNTIME_TOOL_CALL_MARKER):
            continue
        if line.startswith(RUNTIME_RENDER_BLOCK_MARKER):
            continue
        lines.append(raw)
    return "\n".join(lines)
