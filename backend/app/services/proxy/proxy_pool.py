from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from app.core.cache import cache
from app.core.config import settings

logger = logging.getLogger(__name__)

# Redis key helpers（重构版：不再兼容 legacy，加上统一前缀）
_AVAILABLE_SET = "proxy_pool:available"
_ENDPOINT_URL_KEY = "proxy_pool:endpoint:{endpoint_id}:url"
_COOLDOWN_KEY = "proxy_pool:cooldown:{endpoint_id}"
_CFG_ENABLED_KEY = "proxy_pool:config:enabled"
_CFG_COOLDOWN_KEY = "proxy_pool:config:failure_cooldown_seconds"


@dataclass(slots=True, frozen=True)
class ProxySelection:
    """代理选择结果：返回 httpx 可用的 url，保持“像积木一样”对上层透明。"""

    url: str
    endpoint_id: str

    def as_httpx_proxies(self) -> dict[str, str]:
        """httpx/curl-cffi 通用代理格式。"""
        return {"http": self.url, "https": self.url}


def mask_proxy_url(proxy_url: str) -> str:
    """隐藏凭证用于日志。"""
    try:
        from urllib.parse import urlparse

        parsed = urlparse(proxy_url)
        if not parsed.scheme or not parsed.hostname or parsed.port is None:
            return proxy_url
        auth = ""
        if parsed.username:
            auth = f"{parsed.username}:***@"
        return f"{parsed.scheme}://{auth}{parsed.hostname}:{parsed.port}"
    except Exception:
        return proxy_url


class ProxyPool:
    """
    轻量可插拔代理池（重构版）：
    - Redis 结构简化：available set + endpoint:url + cooldown。
    - 失败上报直接用 endpoint_id，无需 fingerprint。
    - Redis 不可用或未启用时自动回退直连。
    """

    def __init__(self, *, cfg_ttl_seconds: float = 5.0) -> None:
        self._cfg_ttl_seconds = cfg_ttl_seconds
        self._cfg_cache_until: float = 0.0
        self._runtime_enabled: bool = settings.UPSTREAM_PROXY_ENABLED
        self._failure_cooldown_seconds: int = settings.UPSTREAM_PROXY_FAILURE_COOLDOWN_SECONDS

    @property
    def _redis(self):
        return getattr(cache, "_redis", None)

    async def pick(self, *, exclude_endpoints: set[str] | None = None) -> ProxySelection | None:
        """
        选择一个代理，失败或未启用时返回 None（调用层可直接走直连）。
        exclude_endpoints: 已尝试过的 endpoint_id 集合，避免同一请求重复使用。
        """
        redis = self._redis
        if redis is None:
            return None

        await self._refresh_runtime_flags(redis)
        if not self._runtime_enabled:
            return None

        exclude_endpoints = exclude_endpoints or set()

        for _ in range(8):
            endpoint_id = await redis.srandmember(_AVAILABLE_SET)
            if not endpoint_id:
                return None
            if isinstance(endpoint_id, bytes):
                endpoint_id = endpoint_id.decode("utf-8")

            if endpoint_id in exclude_endpoints:
                continue

            if await self._in_cooldown(redis, endpoint_id):
                await redis.srem(_AVAILABLE_SET, endpoint_id)
                continue

            proxy_url = await self._get_proxy_url(redis, endpoint_id)
            if not proxy_url:
                await redis.srem(_AVAILABLE_SET, endpoint_id)
                continue

            return ProxySelection(url=proxy_url, endpoint_id=str(endpoint_id))

        return None

    async def report_failure(self, endpoint_id: str) -> None:
        """请求侧反馈：标记代理失效并设置冷却时间。失败不应影响主流程。"""
        if not endpoint_id or not self._runtime_enabled:
            return
        redis = self._redis
        if redis is None:
            return

        try:
            await redis.srem(_AVAILABLE_SET, endpoint_id)
            await redis.set(
                _COOLDOWN_KEY.format(endpoint_id=endpoint_id),
                "1",
                ex=self._failure_cooldown_seconds,
            )
            logger.debug(
                "proxy_pool: reported failure endpoint=%s cooldown=%ss",
                endpoint_id,
                self._failure_cooldown_seconds,
            )
        except Exception as exc:
            logger.debug("proxy_pool: report_failure skipped (%s)", exc)

    async def _refresh_runtime_flags(self, redis) -> None:
        now = time.monotonic()
        if now < self._cfg_cache_until:
            return
        try:
            enabled_raw = await redis.get(_CFG_ENABLED_KEY)
            cooldown_raw = await redis.get(_CFG_COOLDOWN_KEY)
            if enabled_raw is not None:
                enabled_str = enabled_raw.decode() if isinstance(enabled_raw, bytes) else str(enabled_raw)
                self._runtime_enabled = enabled_str == "1"
            else:
                self._runtime_enabled = settings.UPSTREAM_PROXY_ENABLED

            if cooldown_raw:
                cooldown_str = cooldown_raw.decode() if isinstance(cooldown_raw, bytes) else str(cooldown_raw)
                self._failure_cooldown_seconds = int(cooldown_str)
            else:
                self._failure_cooldown_seconds = settings.UPSTREAM_PROXY_FAILURE_COOLDOWN_SECONDS
        except Exception as exc:
            logger.debug("proxy_pool: load runtime config failed (%s)", exc)
        finally:
            self._cfg_cache_until = now + self._cfg_ttl_seconds

    async def _get_proxy_url(self, redis, endpoint_id: str) -> str | None:
        token = await redis.get(_ENDPOINT_URL_KEY.format(endpoint_id=endpoint_id))
        if not token:
            return None
        if isinstance(token, bytes):
            return token.decode("utf-8")
        return str(token)

    async def _in_cooldown(self, redis, endpoint_id: str) -> bool:
        try:
            return bool(await redis.exists(_COOLDOWN_KEY.format(endpoint_id=endpoint_id)))
        except Exception:
            return False

    def build_transport_kwargs(self, selection: ProxySelection | None) -> dict[str, Any]:
        """给 curl-cffi 传递的 transport_kwargs，未选中代理时返回空 dict。"""
        if not selection:
            return {}
        return {"proxies": selection.as_httpx_proxies()}


_shared_pool = ProxyPool()


def get_proxy_pool() -> ProxyPool:
    return _shared_pool


__all__ = ["ProxySelection", "ProxyPool", "get_proxy_pool", "mask_proxy_url"]
