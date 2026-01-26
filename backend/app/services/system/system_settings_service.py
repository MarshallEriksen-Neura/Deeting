from __future__ import annotations

from typing import Any

from app.core import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.repositories import ProviderModelRepository, SystemSettingRepository


EMBEDDING_SETTING_KEY = "embedding_model"


class SystemSettingsService:
    def __init__(
        self,
        settings_repo: SystemSettingRepository,
        model_repo: ProviderModelRepository,
    ):
        self.settings_repo = settings_repo
        self.model_repo = model_repo

    async def get_embedding_model(self) -> str:
        model_name = await self._load_embedding_model()
        return model_name or getattr(settings, "EMBEDDING_MODEL", "text-embedding-3-small")

    async def set_embedding_model(self, model_name: str) -> str:
        if not model_name:
            raise ValueError("Embedding 模型不能为空")
        candidates = await self.model_repo.get_candidates(
            capability="embedding",
            model_id=model_name,
            user_id=None,
            include_public=True,
        )
        if not candidates:
            raise ValueError("Embedding 模型不可用")
        await self.settings_repo.upsert(EMBEDDING_SETTING_KEY, {"model_name": model_name})
        await cache.set(
            CacheKeys.system_embedding_model(),
            model_name,
            ttl=cache.jitter_ttl(settings.CACHE_DEFAULT_TTL),
        )
        return model_name

    async def _load_embedding_model(self) -> str | None:
        setting = await self.settings_repo.get_by_key(EMBEDDING_SETTING_KEY)
        if not setting:
            return None
        value = setting.value
        if isinstance(value, dict):
            model_name = value.get("model_name")
            if isinstance(model_name, str) and model_name.strip():
                return model_name.strip()
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None


async def get_cached_embedding_model() -> str:
    cached = await cache.get(CacheKeys.system_embedding_model())
    if isinstance(cached, str) and cached.strip():
        return cached.strip()

    try:
        async with AsyncSessionLocal() as session:
            repo = SystemSettingRepository(session)
            service = SystemSettingsService(repo, ProviderModelRepository(session))
            model_name = await service.get_embedding_model()
            if model_name:
                await cache.set(
                    CacheKeys.system_embedding_model(),
                    model_name,
                    ttl=cache.jitter_ttl(settings.CACHE_DEFAULT_TTL),
                )
                return model_name
    except Exception:
        pass

    return getattr(settings, "EMBEDDING_MODEL", "text-embedding-3-small")
