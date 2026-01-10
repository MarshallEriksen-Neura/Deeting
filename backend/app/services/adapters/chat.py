"""
聊天入口适配器集合

职责：
- 将不同上游/客户端请求格式转换为内部统一的 ChatCompletionRequest
"""

from __future__ import annotations

from typing import Any

from app.schemas.gateway import (
    AnthropicMessagesRequest,
    ChatCompletionRequest,
    ChatMessage,
    ResponsesRequest,
)


def adapt_openai_chat(raw: Any) -> ChatCompletionRequest:
    """
    OpenAI 兼容入口直通。
    支持 Pydantic 模型或 dict。
    """
    if isinstance(raw, ChatCompletionRequest):
        return raw
    if isinstance(raw, dict):
        return ChatCompletionRequest(**raw)
    # 尝试 Pydantic 的 model_dump
    if hasattr(raw, "model_dump"):
        return ChatCompletionRequest(**raw.model_dump())
    raise ValueError("Unsupported openai chat payload type")


def adapt_anthropic_messages(raw: Any) -> ChatCompletionRequest:
    """
    将 Anthropic /v1/messages 结构转换为内部 ChatCompletionRequest。
    """
    parsed = _ensure_model(AnthropicMessagesRequest, raw)

    messages: list[ChatMessage] = []
    if parsed.system:
        messages.append(ChatMessage(role="system", content=parsed.system))

    for m in parsed.messages:
        content = m.content
        # content 可能是 str 或块列表；对列表仅拼接文本块，保留最简单兼容
        if isinstance(content, list):
            text_parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(str(block.get("text", "")))
                else:
                    text_parts.append(str(block))
            content = "\n".join([p for p in text_parts if p is not None])
        messages.append(ChatMessage(role=m.role, content=content))

    return ChatCompletionRequest(
        model=parsed.model,
        messages=messages,
        stream=parsed.stream,
        temperature=parsed.temperature,
        max_tokens=parsed.max_tokens,
    )


def adapt_responses_request(raw: Any) -> ChatCompletionRequest:
    """
    将 /v1/responses 风格请求转换为 ChatCompletionRequest。
    这里假设 input 代表用户内容。
    """
    parsed = _ensure_model(ResponsesRequest, raw)

    user_content = parsed.input
    if isinstance(user_content, list):
        user_content = "\n".join(str(x) for x in user_content)
    elif isinstance(user_content, dict):
        user_content = str(user_content)

    messages = []
    if parsed.system:
        messages.append(ChatMessage(role="system", content=parsed.system))
    messages.append(ChatMessage(role="user", content=user_content))

    return ChatCompletionRequest(
        model=parsed.model,
        messages=messages,
        stream=parsed.stream,
        temperature=parsed.temperature,
        max_tokens=parsed.max_tokens,
    )


# ===== helpers =====


def _ensure_model(model_cls, raw: Any):
    if isinstance(raw, model_cls):
        return raw
    if isinstance(raw, dict):
        return model_cls(**raw)
    if hasattr(raw, "model_dump"):
        return model_cls(**raw.model_dump())
    raise ValueError(f"Unsupported payload type for {model_cls.__name__}")


__all__ = [
    "adapt_openai_chat",
    "adapt_anthropic_messages",
    "adapt_responses_request",
]
