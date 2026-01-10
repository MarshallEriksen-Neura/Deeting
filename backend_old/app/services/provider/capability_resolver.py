from __future__ import annotations

"""
Provider-level capability resolver.

设计目的：
- 优先使用 Provider/ProviderPreset 元数据中的 capabilities，模型层仅做差异覆盖；
- 便于运行时或任务侧按能力取出 endpoint/request_map/response_map；
- 不再要求每个模型重复填充相同能力数据。

Phase 1 扩展（2026-01）：
- 新增 CapabilityConfig 结构化返回，包含 endpoint/method/request_map/response_map/headers/defaults/adapter；
- resolve_capability_config() 返回 CapabilityConfig 实例，供 RequestTransformer/ResponseAdapter 直接使用；
- 保留原 resolve_capability() 返回 dict 以保持向后兼容。
"""

import logging
from dataclasses import dataclass, field
from typing import Any

from app.schemas.capability_registry import ModelCapability, normalize_capability

logger = logging.getLogger(__name__)


# ============================================================================
# CapabilityConfig 结构化配置
# ============================================================================


@dataclass(frozen=True)
class CapabilityConfig:
    """
    能力级别的完整配置，供 RequestTransformer/ResponseAdapter 使用。

    字段说明：
    - capability: 规范化后的能力枚举值
    - endpoint: 上游请求路径（如 /v1/chat/completions）
    - method: HTTP 方法（默认 POST）
    - request_map: JMESPath 字段映射 {target: source_expr}，用于请求转换
    - response_map: JMESPath 字段映射 {target: source_expr}，用于响应归一化
    - headers: 额外请求头 {header_name: value}
    - query_params: URL 查询参数 {param: value}
    - defaults: 默认请求参数 {field: default_value}
    - adapter: SDK/特殊传输适配器名称（如 "openai_sdk", "anthropic_sdk"），为 None 时走 HTTP
    - version: 能力配置版本（便于未来迁移）
    """

    capability: ModelCapability
    endpoint: str = ""
    method: str = "POST"
    request_map: dict[str, Any] = field(default_factory=dict)
    response_map: dict[str, Any] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    query_params: dict[str, str] = field(default_factory=dict)
    defaults: dict[str, Any] = field(default_factory=dict)
    adapter: str | None = None
    version: str = "v1"

    def has_request_transform(self) -> bool:
        """是否需要请求转换（有非空 request_map 或 defaults）。"""
        return bool(self.request_map) or bool(self.defaults)

    def has_response_transform(self) -> bool:
        """是否需要响应转换（有非空 response_map）。"""
        return bool(self.response_map)

    def uses_sdk_adapter(self) -> bool:
        """是否使用 SDK 适配器而非 HTTP。"""
        return self.adapter is not None


# ============================================================================
# 默认能力端点映射（当 metadata 未配置时使用）
# ============================================================================

_DEFAULT_CAPABILITY_ENDPOINTS: dict[ModelCapability, str] = {
    ModelCapability.CHAT: "/v1/chat/completions",
    ModelCapability.COMPLETION: "/v1/completions",
    ModelCapability.EMBEDDING: "/v1/embeddings",
    ModelCapability.AUDIO: "/v1/audio/speech",
    ModelCapability.IMAGE_GENERATION: "/v1/images/generations",
    ModelCapability.VIDEO_GENERATION: "/v1/video/generations",
    ModelCapability.VISION: "/v1/chat/completions",  # 复用 chat 端点
    ModelCapability.FUNCTION_CALLING: "/v1/chat/completions",  # 复用 chat 端点
}


# ============================================================================
# 内部辅助函数
# ============================================================================


def _get_capabilities_from_metadata(meta: dict[str, Any] | None) -> dict[str, Any]:
    if not meta or not isinstance(meta, dict):
        return {}
    return meta.get("capabilities") or {}


def resolve_capability(
    *,
    provider_meta: dict[str, Any] | None,
    model_meta: dict[str, Any] | None = None,
    capability: str,
) -> dict[str, Any] | None:
    """
    获取指定能力的最终配置：
    1) provider.metadata_json.capabilities[cap]
    2) 若模型提供 _override_capabilities[cap]，则覆盖同名字段

    参数:
        provider_meta: Provider.metadata_json / ProviderPreset.metadata_json
        model_meta: ProviderModel.metadata_json（可选）
        capability: 能力名称或别名（chat/image_generation/...）
    返回:
        dict 或 None（未配置时）

    注意：此函数保留向后兼容，新代码建议使用 resolve_capability_config()。
    """

    cap_key = normalize_capability(capability).value

    base_caps = _get_capabilities_from_metadata(provider_meta)
    base_cfg = base_caps.get(cap_key) or {}

    override_cfg = {}
    if model_meta and isinstance(model_meta, dict):
        override_caps = model_meta.get("_override_capabilities") or {}
        override_cfg = override_caps.get(cap_key) or {}

    if not base_cfg and not override_cfg:
        return None

    merged = dict(base_cfg)
    merged.update(override_cfg)
    return merged


def resolve_capability_config(
    *,
    provider_meta: dict[str, Any] | None,
    model_meta: dict[str, Any] | None = None,
    capability: str,
    base_url: str = "",
) -> CapabilityConfig | None:
    """
    解析能力配置并返回结构化 CapabilityConfig。

    此函数是 resolve_capability() 的增强版本，返回结构化对象而非原始 dict，
    便于 RequestTransformer/ResponseAdapter 直接使用。

    参数:
        provider_meta: Provider.metadata_json / ProviderPreset.metadata_json
        model_meta: ProviderModel.metadata_json（可选）
        capability: 能力名称或别名（chat/image_generation/...）
        base_url: Provider base_url，用于拼接完整端点（可选）

    返回:
        CapabilityConfig 实例，若无配置且无默认端点则返回 None

    配置优先级：
        1. model_meta._override_capabilities[cap] 覆盖
        2. provider_meta.capabilities[cap] 基础配置
        3. _DEFAULT_CAPABILITY_ENDPOINTS 兜底端点
    """

    try:
        cap = normalize_capability(capability)
    except KeyError:
        logger.debug("capability %s 未知，无法解析", capability)
        return None

    merged = resolve_capability(
        provider_meta=provider_meta,
        model_meta=model_meta,
        capability=capability,
    )

    # 若无配置且无默认端点，返回 None
    if not merged and cap not in _DEFAULT_CAPABILITY_ENDPOINTS:
        logger.debug("capability %s 无配置且无默认端点", capability)
        return None

    merged = merged or {}

    # 提取各字段，确保类型正确
    endpoint = merged.get("endpoint") or ""
    if not endpoint:
        # 使用默认端点
        endpoint = _DEFAULT_CAPABILITY_ENDPOINTS.get(cap, "")

    # 拼接 base_url（若端点不以 http 开头）
    if base_url and endpoint and not endpoint.startswith(("http://", "https://")):
        base_url = base_url.rstrip("/")
        if not endpoint.startswith("/"):
            endpoint = "/" + endpoint
        endpoint = base_url + endpoint

    method = str(merged.get("method") or "POST").upper()

    request_map = merged.get("request_map") or {}
    if not isinstance(request_map, dict):
        request_map = {}

    response_map = merged.get("response_map") or {}
    if not isinstance(response_map, dict):
        response_map = {}

    headers = merged.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}

    query_params = merged.get("query_params") or {}
    if not isinstance(query_params, dict):
        query_params = {}

    defaults = merged.get("defaults") or {}
    if not isinstance(defaults, dict):
        defaults = {}

    adapter = merged.get("adapter")
    if adapter is not None:
        adapter = str(adapter)

    version = str(merged.get("version") or "v1")

    return CapabilityConfig(
        capability=cap,
        endpoint=endpoint,
        method=method,
        request_map=request_map,
        response_map=response_map,
        headers=headers,
        query_params=query_params,
        defaults=defaults,
        adapter=adapter,
        version=version,
    )


def list_provider_capabilities(provider_meta: dict[str, Any] | None) -> list[str]:
    """列出 provider 级已声明的能力 key 列表。"""

    return list(_get_capabilities_from_metadata(provider_meta).keys())


def get_default_endpoint(capability: str) -> str | None:
    """获取能力的默认端点（不含 base_url）。"""

    try:
        cap = normalize_capability(capability)
    except KeyError:
        return None
    return _DEFAULT_CAPABILITY_ENDPOINTS.get(cap)


__all__ = [
    "CapabilityConfig",
    "resolve_capability",
    "resolve_capability_config",
    "list_provider_capabilities",
    "get_default_endpoint",
]
