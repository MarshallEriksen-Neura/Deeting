from __future__ import annotations

from typing import Any

from app.protocols.contracts import RuntimeHook


def apply_request_builder(
    builder: RuntimeHook | None,
    body: dict[str, Any],
    request_context: dict[str, Any],
) -> dict[str, Any]:
    if not builder:
        return body

    if builder.name == "inject_literal_fields":
        merged = dict(body)
        merged.update(builder.config.get("fields") or {})
        return merged

    if builder.name == "merge_metadata":
        merged = dict(body)
        metadata = request_context.get("metadata") or {}
        if isinstance(metadata, dict):
            merged.update(metadata)
        return merged

    return body
