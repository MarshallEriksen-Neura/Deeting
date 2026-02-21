"""Lightweight utilities shared across provider modules."""

from __future__ import annotations

from typing import Any


def get_by_path(data: dict | list, path: str) -> Any:
    """Traverse a nested dict/list by dot-separated path.

    >>> get_by_path({"a": {"b": 1}}, "a.b")
    1
    """
    keys = path.split(".")
    curr: Any = data
    for key in keys:
        if isinstance(curr, list) and key.isdigit():
            key = int(key)  # type: ignore[assignment]
        if isinstance(curr, (dict, list)):
            try:
                curr = curr[key]
            except (IndexError, KeyError, TypeError):
                return None
        else:
            return None
    return curr


def extract_items(
    response: dict[str, Any],
    output_mapping: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """从上游响应中提取视频输出项列表。

    :param response: 上游原始响应
    :param output_mapping: 可选的配置驱动映射规则，支持 single_mode 和 items_path
    """
    if not isinstance(response, dict):
        return []

    if not output_mapping:
        # 向后兼容：原有硬编码逻辑
        for key in ("data", "videos", "outputs"):
            items = response.get(key)
            if isinstance(items, list):
                return [item for item in items if isinstance(item, dict)]
        return []

    # 配置驱动：单对象模式（如 Seedance 的 content.video_url）
    single = output_mapping.get("single_mode") or {}
    if single.get("enabled"):
        url_path = single.get("url_path", "")
        url = get_by_path(response, url_path) if url_path else None
        if url:
            item: dict[str, Any] = {"url": url}
            for field, path in (single.get("fields") or {}).items():
                val = get_by_path(response, path)
                if val is not None:
                    item[field] = val
            return [item]
        return []

    # 配置驱动：数组模式
    items_path = output_mapping.get("items_path", "")
    raw = get_by_path(response, items_path) if items_path else response
    if not isinstance(raw, list):
        return []

    schema = output_mapping.get("item_schema") or {}
    if not schema:
        return [item for item in raw if isinstance(item, dict)]

    mapped: list[dict[str, Any]] = []
    for raw_item in raw:
        if not isinstance(raw_item, dict):
            continue
        mapped_item: dict[str, Any] = {}
        for target_field, source_expr in schema.items():
            if isinstance(source_expr, str) and source_expr.startswith("$."):
                val = get_by_path(raw_item, source_expr[2:])
            elif isinstance(source_expr, str):
                val = source_expr  # 常量回填
            else:
                val = source_expr
            if val is not None:
                mapped_item[target_field] = val
        mapped.append(mapped_item)
    return mapped
