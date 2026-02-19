"""
Request Builder Registry

可配置的请求体结构变换器，用于将内部扁平参数转换为厂商特定的请求结构。
在模板渲染后、HTTP 发送前执行。
"""

from __future__ import annotations

import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

BUILDER_REGISTRY: dict[str, Callable[[dict, dict], dict]] = {}


def register_builder(name: str):
    """注册一个 request builder 函数"""

    def decorator(fn: Callable[[dict, dict], dict]):
        BUILDER_REGISTRY[name] = fn
        return fn

    return decorator


def apply_request_builder(
    config: dict[str, Any], request_data: dict[str, Any]
) -> dict[str, Any]:
    """
    如果配置了 request_builder，执行对应的变换；否则原样返回。

    :param config: request_builder 配置，必须包含 "type" 字段
    :param request_data: 内部扁平请求数据
    :return: 变换后的请求体
    """
    builder_type = config.get("type")
    if not builder_type:
        return request_data

    builder_fn = BUILDER_REGISTRY.get(builder_type)
    if not builder_fn:
        logger.warning("request_builder type=%s not found in registry", builder_type)
        return request_data

    return builder_fn(request_data, config)


@register_builder("ark_content_array")
def ark_content_array_builder(
    request_data: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    """
    将扁平请求转换为火山方舟 Ark content[] 格式。

    适用于 Seedance 系列模型，请求体结构为：
    {
        "model": "doubao-seedance-1-5-pro-251215",
        "content": [
            {"type": "text", "text": "prompt --ratio 16:9 --dur 5"},
            {"type": "image_url", "image_url": {"url": "..."}}
        ]
    }

    config 示例：
    {
        "type": "ark_content_array",
        "prompt_flags": {
            "aspect_ratio": "--ratio",
            "duration": "--dur",
            "fps": "--fps",
            "seed": "--seed"
        },
        "image_field": "image_url",
        "image_content_type": "image_url"
    }
    """
    prompt = request_data.get("prompt") or ""
    flags = config.get("prompt_flags") or {}

    # 拼接 --flag 参数到 prompt 末尾
    for field_name, flag in flags.items():
        val = request_data.get(field_name)
        if val is not None:
            prompt += f" {flag} {val}"

    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]

    # 条件追加 image_url 内容项
    image_field = config.get("image_field", "image_url")
    image_url = request_data.get(image_field)
    if image_url:
        content_type = config.get("image_content_type", "image_url")
        content.append(
            {"type": content_type, "image_url": {"url": image_url}}
        )

    return {"model": request_data.get("model"), "content": content}
