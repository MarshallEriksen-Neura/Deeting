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

    if builder.name == "embedding_request_from_input_items":
        merged = dict(body)
        input_items = request_context.get("input_items") or []
        texts: list[str] = []
        for item in input_items:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text:
                    texts.append(text)

        mode = str(builder.config.get("mode") or "openai").strip().lower()
        if mode == "gemini":
            merged.pop("model", None)
            if texts:
                merged["content"] = {"parts": [{"text": texts[0]}]}
            return merged

        request = request_context.get("request") or {}
        if isinstance(request, dict) and request.get("model") is not None:
            merged["model"] = request["model"]
        if texts:
            merged["input"] = texts[0] if len(texts) == 1 else texts
        return merged

    return body
