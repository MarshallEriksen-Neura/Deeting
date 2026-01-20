from __future__ import annotations

import uuid
from sqlalchemy import select, or_, func
from sqlalchemy.orm import selectinload

from app.models.provider_instance import ProviderInstance, ProviderModel
from app.constants.model_capability_map import expand_capabilities
from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.core.logging import logger
from app.utils.time_utils import Datetime

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
            model_count_sq = (
                select(
                    ProviderModel.instance_id,
                    func.count(ProviderModel.id).label("model_count"),
                )
                .group_by(ProviderModel.instance_id)
                .subquery()
            )

            stmt = (
                select(ProviderInstance, model_count_sq.c.model_count)
                .options(selectinload(ProviderInstance.credentials))
                .join(model_count_sq, ProviderInstance.id == model_count_sq.c.instance_id, isouter=True)
                .where(ProviderInstance.is_enabled == True)  # noqa: E712
            )
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
            rows = result.all()
            instances: list[ProviderInstance] = []
            for inst, count in rows:
                # 挂载模型数量，未命中则为 0
                inst.model_count = int(count or 0)  # type: ignore[attr-defined]
                instances.append(inst)
            return instances

        return await cache.get_or_set_singleflight(
            cache_key,
            loader=loader,
            ttl=cache.jitter_ttl(settings.CACHE_DEFAULT_TTL),
        )


class ProviderModelRepository(BaseRepository[ProviderModel]):
    model = ProviderModel

    @staticmethod
    def _dedupe_payloads(models_data: list[dict]) -> list[dict]:
        seen: set[tuple[str | None, str | None]] = set()
        deduped: list[dict] = []
        for payload in models_data:
            key = (
                payload.get("model_id"),
                payload.get("upstream_path"),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(payload)
        return deduped

    async def list(self) -> list[ProviderModel]:
        result = await self.session.execute(select(ProviderModel))
        return list(result.scalars().all())

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
            capability_candidates = expand_capabilities(capability)
            if not capability_candidates:
                return []
            
            # 使用 capabilities 数组包含任意候选能力的过滤逻辑
            # PostgreSQL: capabilities && ARRAY[...]
            # SQLAlchemy: ProviderModel.capabilities.overlap(capability_candidates)
            stmt = (
                select(ProviderModel)
                .join(ProviderInstance, ProviderModel.instance_id == ProviderInstance.id)
                .where(
                    ProviderModel.capabilities.overlap(capability_candidates),
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

    async def update_fields(self, model: ProviderModel, fields: dict) -> ProviderModel:
        """部分字段更新，保持 commit/refresh 一致性。"""
        for k, v in fields.items():
            setattr(model, k, v)
        self.session.add(model)
        await self.session.commit()
        await self.session.refresh(model)
        return model

    async def upsert_for_instance(self, instance_id: uuid.UUID, models_data: list[dict]) -> list[ProviderModel]:
        """批量 Upsert 模型列表：按 instance_id + capability + model_id + upstream_path 唯一键判断。"""
        now = Datetime.utcnow()
        results: list[ProviderModel] = []
        original_count = len(models_data)
        models_data = self._dedupe_payloads(models_data)
        if len(models_data) != original_count:
            logger.warning(
                "provider_model_payloads_deduped "
                f"source=manual instance_id={instance_id} "
                f"before={original_count} after={len(models_data)}"
            )

        for payload in models_data:
            payload = dict(payload)
            payload.pop("_sa_instance_state", None)
            # 避免重复传入 instance_id
            payload.pop("instance_id", None)
            # 允许外部传入 id 以便后续按 id 操作（测试/管理场景）
            incoming_id = payload.pop("id", None)
            payload.pop("synced_at", None)

            stmt = select(ProviderModel).where(
                ProviderModel.instance_id == instance_id,
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
                    id=incoming_id or uuid.uuid4(),
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
        now = Datetime.utcnow()
        results: list[ProviderModel] = []
        original_count = len(models_data)
        models_data = self._dedupe_payloads(models_data)
        if len(models_data) != original_count:
            logger.warning(
                "provider_model_payloads_deduped "
                f"source=upstream instance_id={instance_id} "
                f"before={original_count} after={len(models_data)}"
            )

        protected_fields = {
            "display_name",
            "weight",
            "priority",
            "pricing_config",
            "limit_config",
            "tokenizer_config",
            "routing_config",
            "config_override",
            "is_active",
        }

        for payload in models_data:
            # 防止重复传入 synced_at / 其它字段冲突
            payload = dict(payload)
            payload.pop("id", None)  # 由此处统一生成
            synced_at = payload.pop("synced_at", now)

            stmt = select(ProviderModel).where(
                ProviderModel.instance_id == instance_id,
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
