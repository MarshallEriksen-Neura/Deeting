from __future__ import annotations

from typing import Any

from app.utils import sanitizer_patterns as sp


class Sanitizer:
    """
    轻量级敏感信息脱敏工具：
    - mask_text: 返回掩码后的文本
    - sanitize_payload: 对 dict / list 递归处理
    """

    @staticmethod
    def mask_text(text: str) -> str:
        masked = text
        for pattern, kind in sp.PATTERNS:
            masked = pattern.sub(lambda m: sp.mask_value(m.group(0), kind), masked)
        return masked

    @classmethod
    def sanitize_payload(cls, obj: Any) -> Any:
        if isinstance(obj, dict):
            return {k: cls.sanitize_payload(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [cls.sanitize_payload(v) for v in obj]
        if isinstance(obj, str):
            return cls.mask_text(obj)
        return obj


sanitizer = Sanitizer()


__all__ = ["Sanitizer", "sanitizer"]
