from __future__ import annotations

"""
元数据校验：确保 provider metadata 与 capability_registry 定义对齐，避免字段漂移。

用途：
- Agent 在写入 ProviderMetadata / ProviderPreset.metadata_json 前调用 validate_metadata。
- 运行时可复用做防御性校验（可选）。

校验要点：
- capability key 必须在 registry；
- request_map/response_map 的目标字段必须属于该能力的标准字段集合；
- 填充 schema_version 便于未来迁移。
"""

from typing import Any

from app.schemas.capability_registry import (
    CAPABILITY_SPECS,
    SCHEMA_VERSION,
    get_capability_spec,
    normalize_capability,
)


class MetadataValidationError(ValueError):
    pass


def _validate_map_fields(map_obj: dict[str, Any] | None, allowed_fields: set[str], label: str) -> None:
    if not map_obj:
        return
    for target in map_obj.keys():
        if target not in allowed_fields:
            raise MetadataValidationError(f"{label} 包含未知目标字段: {target}")


def validate_metadata(meta: dict[str, Any]) -> dict[str, Any]:
    """
    校验并返回规范化后的 metadata dict（不会修改入参）。

    预期结构示例：
    {
      "schema_version": "2026-01-04",
      "capabilities": {
         "audio": {"request_map": {...}, "response_map": {...}},
         "image_generation": {...}
      },
      "models": {...},
      ...
    }
    """

    if not isinstance(meta, dict):
        raise MetadataValidationError("metadata 必须是字典")

    norm = dict(meta)
    norm.setdefault("schema_version", SCHEMA_VERSION)

    caps = norm.get("capabilities") or {}
    if not isinstance(caps, dict):
        raise MetadataValidationError("capabilities 必须为字典")

    normalized_caps: dict[str, Any] = {}
    for key, cfg in caps.items():
        cap = normalize_capability(key)
        spec = get_capability_spec(cap)

        cfg = cfg or {}
        if not isinstance(cfg, dict):
            raise MetadataValidationError(f"capabilities.{key} 必须为字典")

        req_map = cfg.get("request_map")
        resp_map = cfg.get("response_map")

        allowed = set(spec.request_fields) if spec.request_fields else set()
        _validate_map_fields(req_map, allowed, f"capabilities.{key}.request_map")

        # response_map 目标字段暂不严格限制（可能按业务返回结构自定义），但可选：如果你希望收紧，可传 allowed。
        _validate_map_fields(resp_map, set(), f"capabilities.{key}.response_map")

        normalized_caps[cap.value] = {**cfg}

    norm["capabilities"] = normalized_caps
    return norm


__all__ = ["validate_metadata", "MetadataValidationError"]
