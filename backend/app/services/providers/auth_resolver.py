from __future__ import annotations

from typing import Any


def resolve_auth_for_protocol(
    *,
    protocol: str | None,
    provider: str | None,
    auth_type: str | None,
    auth_config: dict | None,
    default_headers: dict | None,
) -> tuple[str, dict[str, Any], dict[str, str]]:
    """
    根据协议解析 auth_type 与默认头。

    约定：
    - 仅在 provider=custom 且显式指定 protocol 时启用覆盖逻辑
    - 其余情况沿用 preset 默认配置
    """
    resolved_auth_type = auth_type or "bearer"
    resolved_auth_config: dict[str, Any] = dict(auth_config or {})
    resolved_headers: dict[str, str] = {k: str(v) for k, v in (default_headers or {}).items()}

    proto = (protocol or "").strip().lower()
    provider_lower = (provider or "").strip().lower()
    if provider_lower != "custom" or not proto:
        return resolved_auth_type, resolved_auth_config, resolved_headers

    if "anthropic" in proto or "claude" in proto:
        resolved_auth_type = "api_key"
        resolved_auth_config["header"] = "x-api-key"
        resolved_headers.setdefault("anthropic-version", "2023-06-01")
    elif "azure" in proto:
        resolved_auth_type = "api_key"
        resolved_auth_config["header"] = "api-key"
    elif "gemini" in proto or "google" in proto or "vertex" in proto:
        resolved_auth_type = "api_key"
        resolved_auth_config["header"] = "x-goog-api-key"
    else:
        resolved_auth_type = "bearer"

    return resolved_auth_type, resolved_auth_config, resolved_headers
