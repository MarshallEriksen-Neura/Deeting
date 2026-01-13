import uuid
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload

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
            stmt = select(ProviderInstance).options(selectinload(ProviderInstance.credentials)).where(ProviderInstance.is_enabled == True)  # noqa: E712
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

    async def get_by_instance_id(self, instance_id: uuid.UUID) -> list[ProviderModel]:
        stmt = select(ProviderModel).where(ProviderModel.instance_id == instance_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def upsert_for_instance(self, instance_id: uuid.UUID, models_data: list[dict]) -> list[ProviderModel]:
        """批量 Upsert 模型列表：按 instance_id + capability + model_id + upstream_path 唯一键判断。"""
        from datetime import datetime

        now = datetime.utcnow()
        results: list[ProviderModel] = []

        for payload in models_data:
            stmt = select(ProviderModel).where(
                ProviderModel.instance_id == instance_id,
                ProviderModel.capability == payload["capability"],
                ProviderModel.model_id == payload["model_id"],
                ProviderModel.upstream_path == payload["upstream_path"],
            )
            result = await self.session.execute(stmt)
            existing = result.scalars().first()

            if existing:
                for k, v in payload.items():
                    setattr(existing, k, v)
                existing.synced_at = now
                self.session.add(existing)
                results.append(existing)
            else:
                new_model = ProviderModel(
                    id=uuid.uuid4(),
                    instance_id=instance_id,
                    synced_at=now,
                    **payload,
                )
                self.session.add(new_model)
                results.append(new_model)

        await self.session.commit()
        for r in results:
            await self.session.refresh(r)
        return results

    async def upsert_from_upstream(
        self,
        instance_id: uuid.UUID,
        models_data: list[dict],
        preserve_user_overrides: bool = True,
    ) -> list[ProviderModel]:
        """
        上游同步专用 Upsert：
        - 跳过 source=manual 的记录
        - 可选择保护用户自定义字段
        """
        from datetime import datetime

        now = datetime.utcnow()
        results: list[ProviderModel] = []

        protected_fields = {
            "display_name",
            "weight",
            "priority",
            "pricing_config",
            "limit_config",
            "tokenizer_config",
            "routing_config",
            "is_active",
        }

        for payload in models_data:
            # 防止重复传入 synced_at / 其它字段冲突
            payload = dict(payload)
            payload.pop("id", None)  # 由此处统一生成
            synced_at = payload.pop("synced_at", now)

            stmt = select(ProviderModel).where(
                ProviderModel.instance_id == instance_id,
                ProviderModel.capability == payload["capability"],
                ProviderModel.model_id == payload["model_id"],
                ProviderModel.upstream_path == payload["upstream_path"],
            )
            result = await self.session.execute(stmt)
            existing = result.scalars().first()

            if existing:
                if preserve_user_overrides and existing.source == "manual":
                    results.append(existing)
                    continue

                for k, v in payload.items():
                    if preserve_user_overrides and k in protected_fields:
                        # 保留已有用户定制值
                        continue
                    setattr(existing, k, v)
                existing.synced_at = synced_at
                self.session.add(existing)
                results.append(existing)
            else:
                new_model = ProviderModel(
                    id=uuid.uuid4(),
                    instance_id=instance_id,
                    synced_at=synced_at,
                    **payload,
                )
                self.session.add(new_model)
                results.append(new_model)

        await self.session.commit()
        for r in results:
            await self.session.refresh(r)
        return results
