from __future__ import annotations

import json
from typing import Any

from app.services.providers.config_utils import extract_by_path


def build_blocks_from_message(
    content: str | None,
    reasoning: str | None,
    tool_calls: list | None,
) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    if reasoning:
        blocks.append({"type": "thought", "content": reasoning})
    if content:
        blocks.append({"type": "text", "content": content})
    if isinstance(tool_calls, list):
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            function = call.get("function") or {}
            name = function.get("name") or call.get("name")
            args = function.get("arguments") or call.get("arguments")
            if args is None:
                args_str = None
            elif isinstance(args, str):
                args_str = args
            else:
                args_str = json.dumps(args, ensure_ascii=False)
            blocks.append(
                {"type": "tool_call", "toolName": name, "toolArgs": args_str}
            )
    return blocks


def extract_stream_blocks(
    payload: dict[str, Any],
    stream_transform: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    config = stream_transform or {}
    content_path = config.get("content_path") or "choices.0.delta.content"
    reasoning_path = config.get("reasoning_path") or "choices.0.delta.reasoning_content"
    tool_calls_path = config.get("tool_calls_path") or "choices.0.delta.tool_calls"
    content = extract_by_path(payload, content_path)
    reasoning = extract_by_path(payload, reasoning_path)
    tool_calls = extract_by_path(payload, tool_calls_path)
    return build_blocks_from_message(
        content=content if isinstance(content, str) else None,
        reasoning=reasoning if isinstance(reasoning, str) else None,
        tool_calls=tool_calls if isinstance(tool_calls, list) else None,
    )
