
from sqlalchemy import select, or_

from app.models.provider_preset import ProviderPreset
from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings

from .base import BaseRepository


class ProviderPresetRepository(BaseRepository[ProviderPreset]):
    model = ProviderPreset

    async def get_by_slug(self, slug: str) -> ProviderPreset | None:
        cache_key = CacheKeys.provider_preset(slug)

        async def loader() -> ProviderPreset | None:
            result = await self.session.execute(
                select(ProviderPreset).where(ProviderPreset.slug == slug)
            )
            return result.scalars().first()

        return await cache.get_or_set_singleflight(
            cache_key,
            loader=loader,
            ttl=cache.jitter_ttl(settings.CACHE_DEFAULT_TTL),
        )

    async def get_active_presets(self) -> list[ProviderPreset]:
        cache_key = CacheKeys.provider_preset_active_list()

        async def loader() -> list[ProviderPreset]:
            result = await self.session.execute(
                select(ProviderPreset).where(
                    ProviderPreset.is_active == True,
                )
            )
            return list(result.scalars().all())

        return await cache.get_or_set_singleflight(
            cache_key,
            loader=loader,
            ttl=cache.jitter_ttl(settings.CACHE_DEFAULT_TTL),
        )
