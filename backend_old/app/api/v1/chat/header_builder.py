"""
上游请求 Header 构建器（v2）

目标：
- 统一 HTTP/SSE 请求的 header 处理，避免 transport_handlers 与 transport_handlers_stream 分叉演进。
- 明确区分上游 API 风格（openai/claude）在鉴权头与默认 header 上的差异。
"""

from __future__ import annotations

from typing import Literal

from app.provider.config import ProviderConfig
from app.settings import settings

UpstreamCallStyle = Literal["openai", "claude", "responses"]


def _has_custom_auth_header(custom_headers: dict[str, str] | None) -> bool:
    if not custom_headers:
        return False
    lowered = {str(k).strip().lower() for k in custom_headers.keys()}
    return bool(lowered & {"authorization", "x-api-key", "api-key"})


def build_upstream_headers(
    api_key: str,
    provider_cfg: ProviderConfig,
    *,
    call_style: str,
    is_stream: bool,
) -> dict[str, str]:
    """
    构建访问上游 Provider 的请求头。

    约定：
    - OpenAI/Responses：默认使用 `Authorization: Bearer <key>`
    - Claude：默认使用 `x-api-key: <key>`，并补充 `Anthropic-Version`
    - Stream 请求默认 `Accept: text/event-stream`
    - 允许 provider_cfg.custom_headers 覆盖默认值
    """

    style = str(call_style or "openai").strip().lower()
    accept = "text/event-stream" if is_stream else "application/json"
    headers: dict[str, str] = {
        "Accept": accept,
        "Content-Type": "application/json",
    }

    # 若用户显式配置了 Authorization/x-api-key/api-key，则尊重用户配置，避免同时带多种鉴权头。
    if not _has_custom_auth_header(provider_cfg.custom_headers):
        if style == "claude":
            headers["x-api-key"] = api_key
        else:
            headers["Authorization"] = f"Bearer {api_key}"

    # Claude 风格默认需要声明 Anthropic-Version（即使鉴权头由 custom_headers 提供）。
    if style == "claude":
        headers.setdefault("Anthropic-Version", "2023-06-01")

    if settings.mask_as_browser:
        headers["User-Agent"] = settings.mask_user_agent
        if settings.mask_origin:
            headers["Origin"] = settings.mask_origin
        if settings.mask_referer:
            headers["Referer"] = settings.mask_referer

    if provider_cfg.custom_headers:
        headers.update(provider_cfg.custom_headers)

    return headers


__all__ = ["UpstreamCallStyle", "build_upstream_headers"]
