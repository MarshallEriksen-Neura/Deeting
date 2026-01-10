"""
SecretManager: 上游凭证管理器

设计目标：
- 通过 secret_ref_id 引用获取上游凭证，避免直接在配置中存明文。
- 统一缓存 Key：`gw:upstream_cred:{provider}[:{secret_ref_id}]`，便于轮换时集中失效。
- 提供轮换接口，写入新凭证后同步失效缓存并记录审计日志。

注意：当前实现仍为占位版本，真实场景应接入专用密钥存储（Vault/KMS）。
"""

from __future__ import annotations

import logging
import os

from app.core.cache import cache
from app.core.cache_invalidation import CacheInvalidator
from app.core.cache_keys import CacheKeys
from app.core.config import settings


class SecretManager:
    def __init__(self) -> None:
        self._invalidator = CacheInvalidator()
        self._logger = logging.getLogger(__name__)

    async def get(self, provider: str | None, secret_ref_id: str | None) -> str | None:
        """
        获取上游凭证。

        优先读取缓存，未命中时尝试从环境变量或占位密钥存储中获取。
        - provider 为空时使用 "default" 作为命名空间，避免缓存 key 冲突。
        - 不再回退为 secret_ref_id 本身，确保引用 ID 与明文隔离。
        """
        namespace = provider or "default"

        if not secret_ref_id:
            # 开发/测试兜底密钥，生产应改为强制提供 secret_ref_id
            fallback = settings.JWT_SECRET_KEY or os.getenv("UPSTREAM_DEFAULT_SECRET")
            env_provider_fallback = os.getenv(f"UPSTREAM_{namespace.upper()}_SECRET")
            return env_provider_fallback or fallback

        cache_key = CacheKeys.upstream_credential(namespace, secret_ref_id)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        secret = await self._fetch_from_store(namespace, secret_ref_id)

        if secret:
            await cache.set(cache_key, secret, ttl=300)

        return secret

    async def rotate(self, provider: str, secret_ref_id: str, new_secret: str) -> bool:
        """
        轮换上游凭证：写入新密钥并失效缓存。

        返回 True 表示写入成功。
        """
        if not provider or not secret_ref_id or not new_secret:
            return False

        namespace = provider
        cache_key = CacheKeys.upstream_credential(namespace, secret_ref_id)

        # 占位实现：直接写入缓存；生产应替换为持久化密钥存储写入
        await cache.set(cache_key, new_secret, ttl=300)

        # 缓存失效（同 provider 全部凭证）
        try:
            await self._invalidator.on_secret_rotated(namespace)
        except Exception as exc:
            self._logger.warning(f"secret_rotate_invalidate_failed provider={namespace}: {exc}")

        # 审计日志（仅记录引用信息，避免泄露密钥）
        secret_hint = new_secret[-4:] if len(new_secret) >= 4 else "****"
        self._logger.info(
            "secret_rotated",
            extra={
                "provider": namespace,
                "secret_ref_id": secret_ref_id,
                "secret_hint": secret_hint,
            },
        )

        return True

    async def _fetch_from_store(self, provider: str, secret_ref_id: str) -> str | None:
        """
        占位的密钥读取实现。
        - 优先从环境变量 `UPSTREAM_<PROVIDER>_SECRET` 读取
        - 未配置则返回 None（调用方应处理）
        """
        env_key = f"UPSTREAM_{provider.upper()}_SECRET"
        return os.getenv(env_key)
