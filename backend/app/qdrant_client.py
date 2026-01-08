"""Qdrant 客户端封装（异步 httpx，按事件循环缓存）。

迁移自旧版实现，保持接口兼容：
- qdrant_is_configured(): 开关 + URL 判定
- get_qdrant_client(): 当前事件循环缓存 1 个 AsyncClient
- close_qdrant_client_for_current_loop(): 便于 Celery/短生命周期 loop 释放

所有配置读取自 Settings（QDRANT_*），未启用时抛 QdrantNotConfigured。
"""

from __future__ import annotations

import asyncio
import inspect
from typing import Any
from weakref import WeakKeyDictionary

import httpx

from app.core.config import settings

_qdrant_clients_by_loop: WeakKeyDictionary[asyncio.AbstractEventLoop, httpx.AsyncClient] = (
    WeakKeyDictionary()
)


class QdrantNotConfigured(RuntimeError):
    """表示 Qdrant 未启用或未配置。"""


def qdrant_is_configured() -> bool:
    if not bool(getattr(settings, "QDRANT_ENABLED", False)):
        return False
    url = str(getattr(settings, "QDRANT_URL", "") or "").strip()
    return bool(url)


def _ensure_event_loop() -> asyncio.AbstractEventLoop:
    try:
        return asyncio.get_running_loop()
    except RuntimeError as exc:  # pragma: no cover - 非 async 环境防御
        raise RuntimeError(
            "get_qdrant_client() 必须在运行中的事件循环内调用，请在 async 环境或 asyncio.run(...) 内部调用"
        ) from exc


def _build_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    api_key = str(getattr(settings, "QDRANT_API_KEY", "") or "").strip()
    if api_key:
        headers["api-key"] = api_key
    return headers


def _create_client() -> httpx.AsyncClient:
    if not qdrant_is_configured():
        raise QdrantNotConfigured("Qdrant 未启用或未配置（需要 QDRANT_ENABLED=true 且 QDRANT_URL 非空）")

    url = str(getattr(settings, "QDRANT_URL", "") or "").strip()
    timeout = float(getattr(settings, "QDRANT_TIMEOUT_SECONDS", 10.0) or 10.0)
    return httpx.AsyncClient(base_url=url, timeout=timeout, headers=_build_headers())


def get_qdrant_client() -> httpx.AsyncClient:
    """获取绑定当前事件循环的 Qdrant AsyncClient。"""

    loop = _ensure_event_loop()
    client = _qdrant_clients_by_loop.get(loop)
    if client is None:
        client = _create_client()
        _qdrant_clients_by_loop[loop] = client
    return client


async def _maybe_await(result: Any) -> None:
    if inspect.isawaitable(result):
        await result


async def close_qdrant_client(client: Any) -> None:
    """最佳努力关闭 httpx AsyncClient（或兼容对象）。"""

    close_fn = getattr(client, "aclose", None)
    if callable(close_fn):
        await _maybe_await(close_fn())
        return

    close_fn = getattr(client, "close", None)
    if callable(close_fn):
        await _maybe_await(close_fn())


async def close_qdrant_client_for_current_loop() -> None:
    """关闭并移除当前事件循环缓存的 Qdrant 客户端。"""

    loop = _ensure_event_loop()
    client = _qdrant_clients_by_loop.pop(loop, None)
    if client is None:
        return
    await close_qdrant_client(client)


__all__ = [
    "QdrantNotConfigured",
    "close_qdrant_client",
    "close_qdrant_client_for_current_loop",
    "get_qdrant_client",
    "qdrant_is_configured",
]
