"""
上游 Endpoint 解析器（v2）

目标：
- 将“该调用应走哪个上游协议（openai/claude/responses）+ 哪个 path”的决策从 transport 中抽离。
- 对 static logical model（endpoint 固化）也能在运行时按 Provider 配置选择更原生的 path。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from app.schemas import ProviderConfig
from app.services.chat_routing_service import _apply_upstream_path_override, _select_provider_endpoint
from app.services.provider.capability_resolver import resolve_capability_config

ApiStyle = Literal["openai", "claude", "responses"]


@dataclass(frozen=True)
class UpstreamTarget:
    url: str
    api_style: ApiStyle


def _normalize_style(value: str | None) -> ApiStyle:
    v = str(value or "").strip().lower()
    if v in ("openai", "claude", "responses"):
        return v  # type: ignore[return-value]
    return "openai"


def resolve_http_upstream_target(
    provider_cfg: ProviderConfig,
    *,
    requested_api_style: str,
    default_url: str,
    default_upstream_style: str | None,
    messages_path_override: str | None = None,
    fallback_path_override: str | None = None,
    responses_path_override: str | None = None,
) -> UpstreamTarget:
    """
    解析一次 HTTP 上游调用的目标（url + api_style）。

    规则：
    - 优先尝试 CapabilityResolver (Phase 4) 解析 chat 能力配置。
    - 若无能力配置，回退到 legacy _select_provider_endpoint 逻辑。
    - messages_path_override/fallback_path_override/responses_path_override 允许调用方临时覆盖最终 path。
    """

    # 1) Phase 4: Capability 驱动
    # 仅当 metadata 中显式配置了 capabilities.chat 时才启用，避免默认值覆盖 legacy 逻辑
    has_explicit_cap = False
    if provider_cfg.metadata and isinstance(provider_cfg.metadata, dict):
        caps = provider_cfg.metadata.get("capabilities")
        if isinstance(caps, dict) and "chat" in caps:
            has_explicit_cap = True

    cap_config = None
    if has_explicit_cap:
        cap_config = resolve_capability_config(
            provider_meta=provider_cfg.metadata,
            capability="chat",
            base_url=str(provider_cfg.base_url).rstrip("/"),
        )

    if cap_config:
        chosen_url = cap_config.endpoint
        # 简单映射：目前 adapter 主要是 SDK 标识，HTTP 场景下默认为 openai
        # 若未来 adapter 引入 "claude_http" 等，需在此扩展
        chosen_style = "openai"
        if cap_config.adapter and "claude" in cap_config.adapter:
            chosen_style = "claude"
        elif "messages" in chosen_url and "anthropic" in chosen_url:
            chosen_style = "claude"
    else:
        # 2) Legacy: 用 provider_cfg 选择更原生的 style/path
        selection = _select_provider_endpoint(provider_cfg, str(requested_api_style or "openai"))
        if selection is None:
            chosen_style = _normalize_style(default_upstream_style)
            chosen_url = default_url
        else:
            chosen_style = _normalize_style(selection.api_style)
            selected_path = urlsplit(selection.url).path or "/"
            chosen_url = _apply_upstream_path_override(default_url, selected_path)

    # 3) 应用 request-level override（只覆盖 path，不改 host）
    if chosen_style == "claude" and messages_path_override:
        chosen_url = _apply_upstream_path_override(chosen_url, messages_path_override)
    elif chosen_style == "openai" and fallback_path_override:
        chosen_url = _apply_upstream_path_override(chosen_url, fallback_path_override)
    elif chosen_style == "responses" and responses_path_override:
        chosen_url = _apply_upstream_path_override(chosen_url, responses_path_override)

    return UpstreamTarget(url=chosen_url, api_style=chosen_style)


__all__ = ["UpstreamTarget", "resolve_http_upstream_target"]

