from __future__ import annotations

import inspect
import logging
from typing import Any

import httpx

try:
    from httpx_curl import CurlCFFITransport  # type: ignore

    _curl_transport_available = True
except Exception:  # pragma: no cover - 可选依赖缺失时兜底
    CurlCFFITransport = None  # type: ignore
    _curl_transport_available = False

logger = logging.getLogger(__name__)
_missing_logged = False
_proxy_kwarg_supported: bool | None = None
_proxies_kwarg_supported: bool | None = None
_proxy_kwarg_logged = False


def _build_curl_transport(http2: bool = True, **transport_kwargs: Any) -> httpx.AsyncBaseTransport | None:
    """
    创建 CurlCFFITransport，失败时返回 None（回退到 httpx 默认传输）。
    """
    global _missing_logged

    if not _curl_transport_available:
        if not _missing_logged:
            logger.info("httpx-curl-cffi 未安装，回退使用 httpx 默认传输层")
            _missing_logged = True
        return None

    try:
        return CurlCFFITransport(http2=http2, **transport_kwargs)  # type: ignore[arg-type]
    except Exception as exc:  # pragma: no cover - 运行时异常兜底
        logger.warning("初始化 CurlCFFITransport 失败，回退 httpx 默认传输层: %s", exc)
        return None


def _detect_httpx_proxy_kwargs() -> tuple[bool, bool]:
    global _proxy_kwarg_supported, _proxies_kwarg_supported

    if _proxy_kwarg_supported is not None and _proxies_kwarg_supported is not None:
        return _proxy_kwarg_supported, _proxies_kwarg_supported

    try:
        signature = inspect.signature(httpx.AsyncClient)
        params = signature.parameters
        _proxy_kwarg_supported = "proxy" in params
        _proxies_kwarg_supported = "proxies" in params
    except Exception:
        _proxy_kwarg_supported = False
        _proxies_kwarg_supported = False

    return _proxy_kwarg_supported, _proxies_kwarg_supported


def _normalize_proxy_kwargs(client_kwargs: dict[str, Any]) -> None:
    if "proxy" in client_kwargs and "proxies" in client_kwargs:
        client_kwargs.pop("proxies", None)

    proxy_supported, proxies_supported = _detect_httpx_proxy_kwargs()

    if "proxy" in client_kwargs and not proxy_supported:
        if proxies_supported:
            client_kwargs["proxies"] = client_kwargs.pop("proxy")
        else:
            client_kwargs.pop("proxy", None)

    if "proxies" in client_kwargs and not proxies_supported:
        if proxy_supported:
            client_kwargs["proxy"] = client_kwargs.pop("proxies")
        else:
            client_kwargs.pop("proxies", None)
            global _proxy_kwarg_logged
            if not _proxy_kwarg_logged:
                logger.warning("当前 httpx.AsyncClient 不支持 proxies/proxy 参数，已忽略代理配置。")
                _proxy_kwarg_logged = True


def create_async_http_client(
    *,
    timeout: float | httpx.Timeout | None = None,
    http2: bool = True,
    transport: httpx.AsyncBaseTransport | None = None,
    transport_kwargs: dict[str, Any] | None = None,
    **client_kwargs: Any,
) -> httpx.AsyncClient:
    """
    创建带可选 curl-cffi 传输层的 httpx.AsyncClient。

    - 优先使用 httpx-curl-cffi 提供的 CurlCFFITransport（若可用）。
    - 初始化失败或库缺失时，自动回退到 httpx 默认传输层。
    - transport_kwargs 用于传递给 CurlCFFITransport（如 impersonate/proxies/verify）。
    - 兼容 httpx 版本差异（proxy/proxies）。
    """
    transport_kwargs = transport_kwargs or {}
    if transport is None:
        transport = _build_curl_transport(http2=http2, **transport_kwargs)

    _normalize_proxy_kwargs(client_kwargs)

    return httpx.AsyncClient(
        timeout=timeout,
        http2=http2,
        transport=transport,
        **client_kwargs,
    )
