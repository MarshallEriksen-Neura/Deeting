import uuid
from sqlalchemy import select, or_

from app.models.provider_instance import ProviderInstance, ProviderModel
from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings

from .base import BaseRepository


class ProviderInstanceRepository(BaseRepository[ProviderInstance]):
    model = ProviderInstance

    async def get_available_instances(
        self,
        user_id: str | None,
        include_public: bool = True,
    ) -> list[ProviderInstance]:
        cache_key = CacheKeys.provider_instance_list(user_id, include_public)

        async def loader() -> list[ProviderInstance]:
            stmt = select(ProviderInstance).where(ProviderInstance.is_enabled == True)  # noqa: E712
            user_uuid = None
            if user_id:
                try:
                    user_uuid = uuid.UUID(str(user_id))
                except Exception:
                    user_uuid = None
            if user_id is not None:
                if include_public:
                    stmt = stmt.where(
                        or_(ProviderInstance.user_id == user_uuid, ProviderInstance.user_id.is_(None))
                    )
                else:
                    stmt = stmt.where(ProviderInstance.user_id == user_uuid)
            elif not include_public:
                # 无用户且不包含公共则返回空
                return []
            result = await self.session.execute(stmt)
            return list(result.scalars().all())

        return await cache.get_or_set_singleflight(
            cache_key,
            loader=loader,
            ttl=cache.jitter_ttl(settings.CACHE_DEFAULT_TTL),
        )


class ProviderModelRepository(BaseRepository[ProviderModel]):
    model = ProviderModel

    async def get_candidates(
        self,
        capability: str,
        model_id: str,
        user_id: str | None,
        include_public: bool = True,
    ) -> list[ProviderModel]:
        """
        按 capability + model_id 获取用户可用的模型条目
        """
        cache_key = CacheKeys.provider_model_candidates(capability, model_id, user_id, include_public)
        user_uuid = None
        if user_id:
            try:
                user_uuid = uuid.UUID(str(user_id))
            except Exception:
                user_uuid = None
        if user_id is None and not include_public:
            return []

        async def loader() -> list[ProviderModel]:
            stmt = (
                select(ProviderModel)
                .join(ProviderInstance, ProviderModel.instance_id == ProviderInstance.id)
                .where(
                    ProviderModel.capability == capability,
                    # 支持对外别名 unified_model_id 作为匹配键
                    or_(ProviderModel.model_id == model_id, ProviderModel.unified_model_id == model_id),
                    ProviderModel.is_active == True,  # noqa: E712
                    ProviderInstance.is_enabled == True,  # noqa: E712
                )
            )

            if user_id is not None:
                if include_public:
                    stmt = stmt.where(
                        or_(ProviderInstance.user_id == user_uuid, ProviderInstance.user_id.is_(None))
                    )
                else:
                    stmt = stmt.where(ProviderInstance.user_id == user_uuid)

            result = await self.session.execute(stmt)
            return list(result.scalars().all())

        return await cache.get_or_set_singleflight(
            cache_key,
            loader=loader,
            ttl=cache.jitter_ttl(settings.CACHE_DEFAULT_TTL),
        )
