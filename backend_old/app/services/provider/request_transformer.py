from __future__ import annotations

"""
请求转换器：将统一请求模型转换为上游提供商特定格式。

Phase 2 扩展（2026-01）：
- 新增 transform_with_config() 方法，接收 CapabilityConfig 直接使用其 request_map/defaults；
- 保留原 transform() 方法以保持向后兼容。
"""

import logging
from typing import Any

import jmespath
from pydantic import BaseModel

from app.schemas.capability_registry import get_capability_spec
from app.services.provider.capability_resolver import CapabilityConfig

logger = logging.getLogger(__name__)


class TransformerError(RuntimeError):
    """Base error for transformation operations."""


class RequestTransformer:
    """
    Transforms a unified request (Pydantic model) into a provider-specific request body.
    Supports key mapping and future template-based mapping.
    """

    def transform(
        self,
        request: BaseModel,
        input_map: dict[str, Any] | None = None,
        capability: str | None = None,
    ) -> dict[str, Any]:
        """
        Transform a Pydantic request model using an input map.

        Args:
            request: The standard Pydantic request model.
            input_map: A dictionary mapping target field names to source field names
                      or JMESPath expressions.
                      Example: {"voice_id": "voice", "speed_factor": "speed"}

        Returns:
            The transformed dictionary for the provider request.

        注意：此方法保留向后兼容，新代码建议使用 transform_with_config()。
        """
        # Default to standard dict if no map provided
        source_data = request.model_dump(exclude_none=True)

        # 若未提供 input_map，但传入 capability，则尝试用 capability_registry 默认字段
        if not input_map and capability:
            try:
                spec = get_capability_spec(capability)
                # 默认直接透传规范字段
                allowed_fields = set(spec.request_fields)
                return {k: v for k, v in source_data.items() if k in allowed_fields}
            except Exception:
                pass

        if not input_map:
            return source_data

        return self._apply_map(source_data, input_map)

    def transform_with_config(
        self,
        request: BaseModel | dict[str, Any],
        config: CapabilityConfig,
    ) -> dict[str, Any]:
        """
        使用 CapabilityConfig 转换请求。

        此方法是 transform() 的增强版本，直接使用 CapabilityConfig 中的
        request_map 和 defaults 进行转换。

        Args:
            request: Pydantic 请求模型或原始字典
            config: 从 resolve_capability_config() 获取的 CapabilityConfig

        Returns:
            转换后的字典，可直接作为上游请求体

        转换流程：
            1. 将请求转为字典
            2. 应用 defaults（不覆盖已有值）
            3. 应用 request_map 进行字段映射
        """
        # 1. 转为字典
        if isinstance(request, BaseModel):
            source_data = request.model_dump(exclude_none=True)
        else:
            source_data = dict(request)

        # 2. 应用 defaults（不覆盖已有值）
        if config.defaults:
            for key, default_value in config.defaults.items():
                if key not in source_data:
                    source_data[key] = default_value

        # 3. 应用 request_map
        if not config.request_map:
            return source_data

        return self._apply_map(source_data, config.request_map)

    def transform_dict(
        self,
        request: dict[str, Any],
        input_map: dict[str, Any] | None = None,
        defaults: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        转换原始字典请求（不要求 Pydantic 模型）。

        Args:
            request: 原始请求字典
            input_map: 字段映射规则
            defaults: 默认值（不覆盖已有值）

        Returns:
            转换后的字典

        行为说明：
            - 若有 input_map，则只返回映射后的字段
            - defaults 在 input_map 应用前注入源数据，确保映射可访问默认值
            - 若 defaults 中有字段不在 input_map 映射目标中，则额外追加到结果
        """
        source_data = dict(request)

        # 应用 defaults 到源数据（不覆盖已有值）
        if defaults:
            for key, default_value in defaults.items():
                if key not in source_data:
                    source_data[key] = default_value

        if not input_map:
            return source_data

        # 应用映射
        result = self._apply_map(source_data, input_map)

        # 将 defaults 中不在映射目标中的字段追加到结果
        if defaults:
            mapped_targets = set(input_map.keys())
            for key, value in defaults.items():
                if key not in mapped_targets and key not in result:
                    result[key] = source_data.get(key, value)

        return result

    def _apply_map(
        self,
        source_data: dict[str, Any],
        input_map: dict[str, Any],
    ) -> dict[str, Any]:
        """
        应用字段映射规则。

        Args:
            source_data: 源数据字典
            input_map: 映射规则 {target_key: source_expr | literal}

        Returns:
            映射后的字典
        """
        result: dict[str, Any] = {}
        for target_key, source_expr in input_map.items():
            # If source_expr is a simple string and exists in source_data, use it
            if isinstance(source_expr, str):
                # Try JMESPath search first for nested access (e.g. "extra_body.openai.foo")
                try:
                    val = jmespath.search(source_expr, source_data)
                    if val is not None:
                        result[target_key] = val
                except Exception:
                    # Fallback to direct key access
                    if source_expr in source_data:
                        result[target_key] = source_data[source_expr]
            else:
                # Literal value or complex rule (can be extended)
                result[target_key] = source_expr

        return result


__all__ = ["RequestTransformer", "TransformerError"]
