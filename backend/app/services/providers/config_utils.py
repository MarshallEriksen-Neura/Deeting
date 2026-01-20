from __future__ import annotations

from typing import Any

from jinja2 import BaseLoader, Environment, select_autoescape


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """
    Merge Patch (RFC 7386) 语义：
    - override 中的值为 None 表示删除键
    - dict 递归合并
    - list / scalar 直接覆盖
    """
    merged = dict(base or {})
    for key, value in (override or {}).items():
        if value is None:
            merged.pop(key, None)
            continue
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged.get(key) or {}, value)
        else:
            merged[key] = value
    return merged


def extract_by_path(data: Any, path: str | None) -> Any:
    """
    点路径 + 数组下标提取器：
    - body.task_id
    - body.output.images.0.url
    """
    if path is None:
        return None
    if not path:
        return data
    current = data
    for part in path.split("."):
        if isinstance(current, list):
            if not part.isdigit():
                return None
            idx = int(part)
            if idx < 0 or idx >= len(current):
                return None
            current = current[idx]
            continue
        if isinstance(current, dict):
            if part not in current:
                return None
            current = current.get(part)
            continue
        return None
    return current


def render_value(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        if "{{" in value:
            env = Environment(
                loader=BaseLoader(),
                autoescape=select_autoescape(default=False),
            )
            return env.from_string(value).render(**context)
        return value
    if isinstance(value, dict):
        return {k: render_value(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [render_value(v, context) for v in value]
    return value
