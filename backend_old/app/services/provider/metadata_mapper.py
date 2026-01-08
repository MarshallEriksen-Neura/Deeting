from __future__ import annotations

"""
面向 Agent 的“能力 → metadata”填充器：
- 输入：capability_registry + 生成/人工提供的 request_map / response_map
- 输出：符合 schema_version 的 metadata 片段，可写入 ProviderMetadata / ProviderPreset.metadata_json

关键函数：build_capability_metadata(capability, request_map=None, response_map=None)
"""

from typing import Any

from app.schemas.capability_registry import (
    SCHEMA_VERSION,
    get_capability_spec,
    normalize_capability,
)


def build_capability_metadata(
    capability: str,
    *,
    request_map: dict[str, Any] | None = None,
    response_map: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    cap = normalize_capability(capability)
    spec = get_capability_spec(cap)

    meta = {
        "schema_version": SCHEMA_VERSION,
        "capability": cap.value,
    }

    if request_map:
        meta["request_map"] = dict(request_map)
    if response_map:
        meta["response_map"] = dict(response_map)
    if extra:
        meta.update(extra)

    # 默认请求字段：若未传 request_map，提供按规范字段的直通映射模板
    if not request_map and spec.request_fields:
        meta["request_map"] = {field: field for field in spec.request_fields}

    return meta


def merge_capabilities(cap_metas: list[dict[str, Any]]) -> dict[str, Any]:
    """将多个 capability meta 合并成 {capability: meta} 结构。"""

    merged: dict[str, Any] = {}
    for item in cap_metas:
        cap = item.get("capability")
        if not cap:
            continue
        merged[cap] = {k: v for k, v in item.items() if k != "capability"}
    return {
        "schema_version": SCHEMA_VERSION,
        "capabilities": merged,
    }


__all__ = ["build_capability_metadata", "merge_capabilities"]
