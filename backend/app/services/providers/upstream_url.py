from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

_VERSION_PATH_RE = re.compile(r"/(?:api/)?v\d+(?:\.\d+)?(?:/|$)", re.IGNORECASE)


def _has_versioned_path(base_url: str) -> bool:
    try:
        path = urlparse(base_url).path or ""
    except Exception:
        return False
    if not path:
        return False
    return bool(_VERSION_PATH_RE.search(path.rstrip("/")))


def build_upstream_url(
    base_url: str,
    upstream_path: str,
    protocol: str | None,
    *,
    auto_append_v1: bool | None = None,
) -> str:
    base = (base_url or "").rstrip("/")
    path = (upstream_path or "").lstrip("/")
    proto = (protocol or "").lower()

    if "azure" not in proto and "openai" in proto:
        if auto_append_v1 is None:
            append_v1 = not _has_versioned_path(base)
        else:
            append_v1 = bool(auto_append_v1)
        if append_v1 and base and not base.endswith("/v1"):
            base = f"{base}/v1"

    if not path:
        return base
    return f"{base}/{path}"


def build_upstream_url_with_params(
    base_url: str,
    upstream_path: str,
    protocol: str | None,
    *,
    auto_append_v1: bool | None = None,
    api_version: str | None = None,
) -> tuple[str, dict[str, Any]]:
    params: dict[str, Any] = {}
    base = (base_url or "").rstrip("/")
    path = (upstream_path or "").lstrip("/")
    proto = (protocol or "").lower()

    if "azure" in proto:
        version = api_version or "2023-05-15"
        params["api-version"] = version
        return build_upstream_url(base, path, protocol, auto_append_v1=False), params

    if "gemini" in proto or "google" in proto or "vertex" in proto:
        return build_upstream_url(base, path, protocol, auto_append_v1=False), params

    return build_upstream_url(base, path, protocol, auto_append_v1=auto_append_v1), params
