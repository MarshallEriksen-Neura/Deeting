"""
模型能力映射规则

- 先匹配显式前缀/通配表，再用正则兜底
- 未命中则默认为 chat
"""

from __future__ import annotations

import re
from collections.abc import Iterable

# 规范能力名（canonical）
CANONICAL_CAPABILITIES: set[str] = {
    "chat",
    "embedding",
    "image_generation",
    "text_to_speech",
    "speech_to_text",
    "video_generation",
}

# 兼容历史/别名能力写法（key 会先经过 normalize）
_CAPABILITY_ALIAS_TO_CANONICAL: dict[str, str] = {
    "chat": "chat",
    "chat_completion": "chat",
    "chat_completions": "chat",
    "text_generation": "chat",
    "text": "chat",
    "reasoning": "chat",
    "code": "chat",
    "vision": "chat",
    "embedding": "embedding",
    "embeddings": "embedding",
    "vector": "embedding",
    "image_generation": "image_generation",
    "image": "image_generation",
    "image_gen": "image_generation",
    "text_to_image": "image_generation",
    "text_to_speech": "text_to_speech",
    "tts": "text_to_speech",
    "speech": "text_to_speech",
    "speech_to_text": "speech_to_text",
    "stt": "speech_to_text",
    "audio": "speech_to_text",
    "audio_to_text": "speech_to_text",
    "transcription": "speech_to_text",
    "video_generation": "video_generation",
    "video": "video_generation",
    "video_gen": "video_generation",
    "text_to_video": "video_generation",
    "t2v": "video_generation",
}

# 显式前缀/通配映射（按顺序匹配，首个命中即用）
PREFIX_RULES: list[tuple[str, list[str]]] = [
    ("text-embedding", ["embedding"]),
    ("embedding", ["embedding"]),
    ("ada-embedding", ["embedding"]),
    ("whisper", ["speech_to_text"]),
    ("tts-", ["text_to_speech"]),
    ("gpt-image", ["image_generation"]),
    ("dall-e", ["image_generation"]),
    ("sd", ["image_generation"]),
    ("flux", ["image_generation"]),
    ("glm-image", ["image_generation"]),
    ("qwen-image", ["image_generation"]),
    ("claude", ["chat"]),  # 默认仍视作 chat
]

# 正则兜底
REGEX_RULES: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"(embed|embedding)", re.I), ["embedding"]),
    (re.compile(r"(whisper|transcrib|stt|speech-to-text)", re.I), ["speech_to_text"]),
    (re.compile(r"(tts|text-to-speech)", re.I), ["text_to_speech"]),
    (
        re.compile(r"(dall[-_]?e|sdxl?|flux|image|img|pixart|kolors|kandinsky)", re.I),
        ["image_generation"],
    ),
]


def _normalize_token(value: str | None) -> str:
    if value is None:
        return ""
    return str(value).strip().lower().replace("-", "_").replace(" ", "_")


def normalize_capability(capability: str | None) -> str | None:
    token = _normalize_token(capability)
    if not token:
        return None
    return _CAPABILITY_ALIAS_TO_CANONICAL.get(token, token)


def normalize_capabilities(
    capabilities: Iterable[str] | None,
    *,
    default: str | None = None,
) -> list[str]:
    normalized: list[str] = []
    for capability in capabilities or []:
        canonical = normalize_capability(capability)
        if canonical and canonical not in normalized:
            normalized.append(canonical)
    if normalized:
        return normalized
    fallback = normalize_capability(default) if default else None
    return [fallback] if fallback else []


_CAPABILITY_EXPANSION_MAP: dict[str, list[str]] = {}
for alias, canonical in _CAPABILITY_ALIAS_TO_CANONICAL.items():
    if alias == canonical:
        continue
    _CAPABILITY_EXPANSION_MAP.setdefault(canonical, [])
    if alias not in _CAPABILITY_EXPANSION_MAP[canonical]:
        _CAPABILITY_EXPANSION_MAP[canonical].append(alias)


def expand_capabilities(capability: str | None) -> list[str]:
    canonical = normalize_capability(capability)
    if not canonical:
        return []
    expanded: list[str] = [canonical]
    for alias in _CAPABILITY_EXPANSION_MAP.get(canonical, []):
        if alias not in expanded:
            expanded.append(alias)
        kebab = alias.replace("_", "-")
        if kebab not in expanded:
            expanded.append(kebab)
    kebab_canonical = canonical.replace("_", "-")
    if kebab_canonical not in expanded:
        expanded.append(kebab_canonical)
    raw = str(capability).strip().lower()
    if raw and raw not in expanded:
        expanded.append(raw)
    return expanded


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
