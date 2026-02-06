from __future__ import annotations

import json
from typing import Any

from app.services.providers.config_utils import extract_by_path


def build_normalized_blocks(
    content: str | None = None,
    reasoning: str | None = None,
    tool_calls: list | None = None,
) -> list[dict[str, Any]]:
    """
    统一构建消息块 (Blocks) 的逻辑。
    
    功能：
    1. 处理显式的 reasoning (思维链) 字段。
    2. 将 content 作为 text block（不解析 <think> 等标签）。
    3. 格式化 tool_calls。
    4. 返回标准化的 Block 列表。
    """
    blocks: list[dict[str, Any]] = []

    # 1. 优先处理显式的思维链字段 (通常来自 DeepSeek/OpenAI o1 的 reasoning_content)
    if reasoning and reasoning.strip():
        blocks.append({"type": "thought", "content": reasoning.strip()})

    # 2. 处理正文：dev 模式下不解析 <think> 等标签，避免多套协议导致后期维护困难。
    if content and content.strip():
        blocks.append({"type": "text", "content": content})

    # 3. 处理工具调用
    if isinstance(tool_calls, list):
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            call_id = call.get("id")
            call_id = call_id if isinstance(call_id, str) and call_id else None
            function = call.get("function") or {}
            name = function.get("name") or call.get("name")
            args = function.get("arguments") or call.get("arguments")
            
            if args is None:
                args_str = None
            elif isinstance(args, str):
                args_str = args
            else:
                args_str = json.dumps(args, ensure_ascii=False)
                
            block: dict[str, Any] = {
                "type": "tool_call",
                "toolName": name,
                "toolArgs": args_str,
            }
            if call_id:
                block["callId"] = call_id
            blocks.append(block)

    return blocks


# 保持兼容性别名，但在新代码中应使用 build_normalized_blocks
def build_blocks_from_message(
    content: str | None,
    reasoning: str | None,
    tool_calls: list | None,
) -> list[dict[str, Any]]:
    return build_normalized_blocks(content, reasoning, tool_calls)


def extract_stream_blocks(
    payload: dict[str, Any],
    stream_transform: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    config = stream_transform or {}
    
    # 默认路径配置 (OpenAI Compatible)
    content_path = config.get("content_path") or "choices.0.delta.content"
    reasoning_path = config.get("reasoning_path") or "choices.0.delta.reasoning_content"
    tool_calls_path = config.get("tool_calls_path") or "choices.0.delta.tool_calls"
    
    content = extract_by_path(payload, content_path)
    reasoning = extract_by_path(payload, reasoning_path)
    tool_calls = extract_by_path(payload, tool_calls_path)

    # 自动兼容 Anthropic SSE 格式 (作为代码兜底)
    # 当流式配置未覆盖时生效
    if not content and not reasoning and payload.get("type") == "content_block_delta":
        delta = payload.get("delta") or {}
        if delta.get("type") == "thinking_delta":
            reasoning = delta.get("thinking")
        elif delta.get("type") == "text_delta":
            content = delta.get("text")

    return build_normalized_blocks(
        content=content if isinstance(content, str) else None,
        reasoning=reasoning if isinstance(reasoning, str) else None,
        tool_calls=tool_calls if isinstance(tool_calls, list) else None,
    )
