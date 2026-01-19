"""
模型能力映射规则

- 先匹配显式前缀/通配表，再用正则兜底
- 未命中则默认为 chat
"""

from __future__ import annotations

import re
from typing import Iterable, List

# 显式前缀/通配映射（按顺序匹配，首个命中即用）
PREFIX_RULES: list[tuple[str, list[str]]] = [
    ("text-embedding", ["embedding"]),
    ("embedding", ["embedding"]),
    ("ada-embedding", ["embedding"]),
    ("whisper", ["audio"]),
    ("tts-", ["audio"]),
    ("audio-", ["audio"]),
    ("gpt-image", ["image"]),
    ("dall-e", ["image"]),
    ("sd", ["image"]),
    ("flux", ["image"]),
    ("glm-image", ["image"]),
    ("qwen-image", ["image"]),
    ("claude", ["chat"]),  # 默认仍视作 chat
    ("gpt-4o", ["chat", "vision", "audio", "reasoning"]),
    ("o1", ["chat", "reasoning"]),
    ("deepseek-reasoner", ["reasoning"]),
]

# 正则兜底
REGEX_RULES: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"(embed|embedding)", re.I), ["embedding"]),
    (re.compile(r"(whisper|audio|speech|tts)", re.I), ["audio"]),
    (re.compile(r"(dall[-_]?e|sdxl?|flux|image|img|pixart|kolors|kandinsky)", re.I), ["image"]),
    (re.compile(r"(vision|multimodal)", re.I), ["chat", "vision"]),
    (re.compile(r"(code|coder|codestral)", re.I), ["code"]),
    (re.compile(r"(reasoner|o1|o3|o4|r1)", re.I), ["reasoning"]),
]


def guess_capabilities(model_id: str) -> list[str]:
    """根据模型 ID 猜测能力列表，未命中时返回 ['chat']。"""
    mid = model_id.lower()
    for prefix, caps in PREFIX_RULES:
        if mid.startswith(prefix):
            return caps

    for pattern, caps in REGEX_RULES:
        if pattern.search(model_id):
            return caps

    return ["chat"]


def primary_capability(caps: Iterable[str]) -> str:
    """选择首个能力作为 provider_model.capability 字段。"""
    for c in caps:
        return c
    return "chat"
