"""
SecretManager: 上游凭证管理器

设计目标：
- 通过 secret_ref_id 引用获取上游凭证，避免直接在配置中存明文。
- 统一缓存 Key：`gw:upstream_cred:{provider}[:{secret_ref_id}]`，便于轮换时集中失效。
- 提供轮换接口，写入新凭证后同步失效缓存并记录审计日志。

注意：当前实现仍为占位版本，真实场景应接入专用密钥存储（Vault/KMS）。
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
import uuid

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_invalidation import CacheInvalidator
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.repositories.upstream_secret_repository import UpstreamSecretRepository


class SecretManager:
    def __init__(self) -> None:
        self._invalidator = CacheInvalidator()
        self._logger = logging.getLogger(__name__)
        self._fernet: Fernet | None = None

    def _get_fernet(self) -> Fernet:
        if self._fernet:
            return self._fernet
        secret_key = (settings.SECRET_KEY or "").strip()
        if not secret_key:
            raise RuntimeError("SECRET_KEY not configured")
        digest = hashlib.sha256(secret_key.encode("utf-8")).digest()
        fernet_key = base64.urlsafe_b64encode(digest)
        self._fernet = Fernet(fernet_key)
        return self._fernet

    def _encrypt_secret(self, secret: str) -> str:
        fernet = self._get_fernet()
        return fernet.encrypt(secret.encode("utf-8")).decode("utf-8")

    def _decrypt_secret(self, token: str) -> str | None:
        try:
            fernet = self._get_fernet()
        except RuntimeError:
            return None
        try:
            return fernet.decrypt(token.encode("utf-8")).decode("utf-8")
        except InvalidToken:
            return None

    @staticmethod
    def _is_db_ref(secret_ref_id: str) -> bool:
        return secret_ref_id.startswith("db:")

    @staticmethod
    def _parse_db_ref(secret_ref_id: str) -> uuid.UUID | None:
        if not secret_ref_id.startswith("db:"):
            return None
        try:
            return uuid.UUID(secret_ref_id[3:])
        except Exception:
            return None

    @staticmethod
    def _looks_like_plain_secret(value: str) -> bool:
        if not value:
            return False
        if re.match(r"^(sk|ak|AIza)-[a-zA-Z0-9_-]{16,}$", value):
            return True
        if value.lower().startswith("bearer ") and len(value) > 15:
            return True
        if value.startswith("eyJ") and len(value) > 30 and "." in value:
            return True
        if re.match(r"^LTAI[a-zA-Z0-9]{16,24}$", value):
            return True
        return False

    async def _cache_set_encrypted(self, cache_key: str, secret: str) -> None:
        try:
            encrypted = self._encrypt_secret(secret)
        except RuntimeError:
            return
        await cache.set(cache_key, encrypted, ttl=300)

    async def get(
        self,
        provider: str | None,
        secret_ref_id: str | None,
        db_session: AsyncSession | None = None,
        allow_env: bool = False,
    ) -> str | None:
        """
        获取上游凭证。

        优先读取缓存，未命中时可选从环境变量获取（仅显式开启）。
        - provider 为空时使用 "default" 作为命名空间，避免缓存 key 冲突。
        - 不再回退为 secret_ref_id 本身，确保引用 ID 与明文隔离。
        """
        namespace = provider or "default"

        if not secret_ref_id:
            return None

        cache_key = CacheKeys.upstream_credential(namespace, secret_ref_id)
        cached = await cache.get(cache_key)
        if cached:
            secret = self._decrypt_secret(str(cached))
            if secret:
                return secret
            await cache.delete(cache_key)

        if self._is_db_ref(secret_ref_id):
            if not db_session:
                self._logger.warning("secret_db_ref_without_session ref=%s", secret_ref_id)
                return None
            secret = await self._fetch_from_db(db_session, namespace, secret_ref_id)
            if secret:
                await self._cache_set_encrypted(cache_key, secret)
            return secret

        if self._looks_like_plain_secret(secret_ref_id):
            self._logger.error("plaintext_secret_ref_blocked ref=%s", secret_ref_id[:6])
            return None

        if not allow_env:
            self._logger.warning("secret_env_lookup_disabled ref=%s", secret_ref_id[:6])
            return None

        secret = await self._fetch_from_store(namespace, secret_ref_id)

        if secret:
            await self._cache_set_encrypted(cache_key, secret)

        return secret

    async def store(
        self,
        provider: str | None,
        raw_secret: str,
        db_session: AsyncSession,
        secret_ref_id: str | None = None,
    ) -> str:
        """
        存储上游密钥（加密），返回 secret_ref_id。
        """
        namespace = provider or "default"
        secret_id = None
        if secret_ref_id:
            secret_id = self._parse_db_ref(secret_ref_id)

        if not secret_id:
            secret_id = uuid.uuid4()
            secret_ref_id = f"db:{secret_id}"

        encrypted = self._encrypt_secret(raw_secret)
        repo = UpstreamSecretRepository(db_session)
        existing = await repo.get(secret_id)
        payload = {
            "provider": namespace,
            "encrypted_secret": encrypted,
            "secret_hint": raw_secret[-4:] if len(raw_secret) >= 4 else "****",
        }
        if existing:
            await repo.update(existing, payload)
        else:
            await repo.create(
                {
                    "id": secret_id,
                    "provider": namespace,
                    "encrypted_secret": encrypted,
                    "secret_hint": payload["secret_hint"],
                }
            )

        cache_key = CacheKeys.upstream_credential(namespace, secret_ref_id)
        await self._cache_set_encrypted(cache_key, raw_secret)
        return secret_ref_id

    async def rotate(self, provider: str, secret_ref_id: str, new_secret: str, db_session: AsyncSession | None = None) -> bool:
        """
        轮换上游凭证：写入新密钥并失效缓存。

        返回 True 表示写入成功。
        """
        if not provider or not secret_ref_id or not new_secret:
            return False
        if not db_session or not self._is_db_ref(secret_ref_id):
            return False

        namespace = provider
        await self.store(namespace, new_secret, db_session, secret_ref_id=secret_ref_id)

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
        - 优先从环境变量 `secret_ref_id` 读取
        - 其次从环境变量 `UPSTREAM_<PROVIDER>_SECRET` 读取
        - 未配置则返回 None（调用方应处理）
        """
        if secret_ref_id:
            direct = os.getenv(secret_ref_id)
            if direct:
                return direct
        env_key = f"UPSTREAM_{provider.upper()}_SECRET"
        return os.getenv(env_key)

    async def _fetch_from_db(
        self,
        db_session: AsyncSession,
        provider: str,
        secret_ref_id: str,
    ) -> str | None:
        secret_id = self._parse_db_ref(secret_ref_id)
        if not secret_id:
            return None
        repo = UpstreamSecretRepository(db_session)
        record = await repo.get(secret_id)
        if not record or record.provider != provider:
            return None
        return self._decrypt_secret(record.encrypted_secret)
