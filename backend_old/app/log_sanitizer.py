from __future__ import annotations

from collections.abc import Mapping

REDACTED = "***REDACTED***"


_SENSITIVE_HEADER_NAMES = {
    "authorization",
    "proxy-authorization",
    "x-api-key",
    "api-key",
    "x-auth-token",
    "x-access-token",
    "x-session-id",
    "cookie",
    "set-cookie",
}


def sanitize_headers_for_log(
    headers: Mapping[str, str], *, mask_token: str = REDACTED
) -> dict[str, str]:
    """
    将请求头做安全脱敏后用于日志输出。

    - 明确敏感的 header 名（authorization / x-api-key / cookie 等）直接打码；
    - 包含敏感关键词（key/token/secret/auth/cookie/session）的 header 名也打码；
    - 其它 header 原样保留，便于排障。
    """
    sanitized: dict[str, str] = {}
    for name, value in headers.items():
        lower_name = name.lower()
        if lower_name in _SENSITIVE_HEADER_NAMES:
            sanitized[name] = mask_token
            continue

        if any(
            token in lower_name
            for token in ("key", "token", "secret", "auth", "cookie", "session")
        ):
            sanitized[name] = mask_token
            continue

        sanitized[name] = value
    return sanitized


__all__ = ["REDACTED", "sanitize_headers_for_log"]
