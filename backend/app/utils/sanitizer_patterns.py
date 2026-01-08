"""集中管理敏感信息检测模式与掩码工具。"""

from __future__ import annotations

import re
from typing import Pattern

# 常见敏感信息模式（可按需扩展）
PHONE_PATTERN: Pattern = re.compile(r"(?<!\d)(1[3-9]\d{9})(?!\d)")
EMAIL_PATTERN: Pattern = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
ID_PATTERN: Pattern = re.compile(r"\b\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]\b")
CARD_PATTERN: Pattern = re.compile(r"\b\d{13,19}\b")
TOKEN_PATTERN: Pattern = re.compile(r"\b(sk-|rk-|pk_)[A-Za-z0-9-_]{10,}\b")

PATTERNS = [
    (PHONE_PATTERN, "phone"),
    (EMAIL_PATTERN, "email"),
    (ID_PATTERN, "id"),
    (CARD_PATTERN, "card"),
    (TOKEN_PATTERN, "token"),
]


def mask_value(value: str, kind: str) -> str:
    """根据类型进行简单掩码，保留部分可识别信息。"""
    if kind == "phone" and len(value) == 11:
        return f"{value[:3]}****{value[-4:]}"
    if kind == "email" and "@" in value:
        name, domain = value.split("@", 1)
        if len(name) <= 1:
            return "***@" + domain
        return name[0] + "***@" + domain
    if kind in {"id", "card"} and len(value) > 8:
        return value[:4] + "****" + value[-4:]
    if kind == "token":
        return value[:4] + "..." + value[-4:]
    return "***"
