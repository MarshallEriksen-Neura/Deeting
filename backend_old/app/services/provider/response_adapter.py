from __future__ import annotations

"""
响应适配器：将上游提供商响应转换为统一格式。

Phase 2 扩展（2026-01）：
- 新增 adapt_with_config() 方法，接收 CapabilityConfig 直接使用其 response_map；
- 保留原 adapt_by_map() 等方法以保持向后兼容。
"""

import logging
import time
from typing import Any

import jmespath

from app.services.provider.capability_resolver import CapabilityConfig

logger = logging.getLogger(__name__)


class AdapterError(RuntimeError):
    """Base error for response adaptation operations."""


class ResponseAdapter:
    """
    Adapts a provider-specific response into a unified response format.
    """

    def adapt_video_response(
        self,
        provider_response: dict[str, Any],
        output_map: dict[str, Any] | None = None,
        response_maps: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Adapt provider video response to Unified VideoGenerationResponse.

        Default (OpenAI Style): {"data": [{"url": "...", "revised_prompt": "..."}]}
        """
        if not output_map and response_maps:
            output_map = response_maps.get("video")

        if not output_map:
            # Default to direct pass-through or OpenAI standard
            return provider_response

        # Extract items using JMESPath if rule provided
        items_expr = output_map.get("items_extractor", "data")
        raw_items = jmespath.search(items_expr, provider_response) or []

        url_expr = output_map.get("url_extractor", "url")
        prompt_expr = output_map.get("prompt_extractor", "revised_prompt")

        adapted_data = []
        for item in raw_items:
            adapted_data.append(
                {
                    "url": jmespath.search(url_expr, item),
                    "revised_prompt": jmespath.search(prompt_expr, item),
                }
            )

        return {"created": int(time.time()), "data": adapted_data}

    def adapt_audio_response(
        self,
        provider_response: Any,
        output_map: dict[str, Any] | None = None,
        response_maps: dict[str, Any] | None = None,
    ) -> Any:
        """
        Adapt audio response.
        If it's raw bytes, pass through.
        If it's JSON with a URL, extract the URL.
        """
        if output_map is None and response_maps:
            output_map = response_maps.get("audio")

        if isinstance(provider_response, bytes):
            return provider_response

        if not output_map or not isinstance(provider_response, dict):
            return provider_response

        url_expr = output_map.get("url_extractor")
        if url_expr:
            url = jmespath.search(url_expr, provider_response)
            if url:
                return {"url": url}

        return provider_response

    def adapt_by_map(
        self, provider_response: Any, output_map: dict[str, Any] | None = None
    ) -> Any:
        """
        通用映射：根据 output_map 将上游返回转换为内部字段。

        约定：
        - output_map 为 { target_field: jmespath_expr | literal }
        - 若 value 为字符串，使用 jmespath 搜索；若搜索结果为 None，则不写入。
        - 若 value 非字符串，直接作为字面值写入。
        - output_map 为空或 None 时，原样返回。

        注意：此方法保留向后兼容，新代码建议使用 adapt_with_config()。
        """

        if not output_map or not isinstance(provider_response, (dict, list)):
            return provider_response

        return self._apply_map(provider_response, output_map)

    def adapt_with_config(
        self,
        provider_response: Any,
        config: CapabilityConfig,
    ) -> Any:
        """
        使用 CapabilityConfig 适配响应。

        此方法是 adapt_by_map() 的增强版本，直接使用 CapabilityConfig 中的
        response_map 进行转换。

        Args:
            provider_response: 上游提供商返回的原始响应
            config: 从 resolve_capability_config() 获取的 CapabilityConfig

        Returns:
            转换后的响应，若无 response_map 则原样返回
        """
        if not config.has_response_transform():
            return provider_response

        if not isinstance(provider_response, (dict, list)):
            return provider_response

        return self._apply_map(provider_response, config.response_map)

    def _apply_map(
        self,
        provider_response: dict[str, Any] | list[Any],
        output_map: dict[str, Any],
    ) -> dict[str, Any]:
        """
        应用输出映射规则。

        Args:
            provider_response: 上游响应（字典或列表）
            output_map: 映射规则 {target: jmespath_expr | literal}

        Returns:
            映射后的字典
        """
        mapped: dict[str, Any] = {}
        for target, expr in output_map.items():
            if isinstance(expr, str):
                try:
                    val = jmespath.search(expr, provider_response)
                except Exception:
                    val = None
                if val is not None:
                    mapped[target] = val
            else:
                mapped[target] = expr
        return mapped or (
            provider_response if isinstance(provider_response, dict) else {}
        )


__all__ = ["ResponseAdapter", "AdapterError"]
