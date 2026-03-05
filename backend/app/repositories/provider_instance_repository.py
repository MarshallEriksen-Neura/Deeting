from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import defer, selectinload
from sqlalchemy.orm.attributes import set_committed_value

from app.constants.model_capability_map import expand_capabilities
from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.core.logging import logger
from app.models.provider_instance import (
    ProviderInstance,
    ProviderModel,
    ProviderModelEntitlement,
)
from app.utils.provider_model_access import (
    parse_unlock_price_credits,
    requires_model_purchase,
)
from app.utils.time_utils import Datetime

from .base import BaseRepository

_PROVIDER_INSTANCE_HAS_IS_PUBLIC: bool | None = None


async def _has_provider_instance_is_public_column(session) -> bool:
    """Detect whether provider_instance.is_public exists in current DB schema."""
    global _PROVIDER_INSTANCE_HAS_IS_PUBLIC

    if _PROVIDER_INSTANCE_HAS_IS_PUBLIC is not None:
        return _PROVIDER_INSTANCE_HAS_IS_PUBLIC

    dialect = (
        session.bind.dialect.name if getattr(session, "bind", None) else None
    )
    if dialect != "postgresql":
        _PROVIDER_INSTANCE_HAS_IS_PUBLIC = True
        return _PROVIDER_INSTANCE_HAS_IS_PUBLIC

    try:
        result = await session.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'provider_instance'
                  AND column_name = 'is_public'
                LIMIT 1
                """
            )
        )
        _PROVIDER_INSTANCE_HAS_IS_PUBLIC = result.scalar_one_or_none() is not None
    except Exception as exc:
        logger.warning(
            "provider_instance_is_public_column_probe_failed "
            f"error={exc!s}; fallback_to_legacy_public_rule=true"
        )
        _PROVIDER_INSTANCE_HAS_IS_PUBLIC = False

    if not _PROVIDER_INSTANCE_HAS_IS_PUBLIC:
        logger.warning(
            "provider_instance_is_public_column_missing "
            "fallback_to_legacy_public_rule=true"
        )
    return _PROVIDER_INSTANCE_HAS_IS_PUBLIC


def _public_instance_clause(has_is_public: bool):
    if has_is_public:
        return or_(
            ProviderInstance.is_public.is_(True),
            ProviderInstance.user_id.is_(None),
        )
    return ProviderInstance.user_id.is_(None)


def _apply_legacy_is_public(instance: ProviderInstance | None) -> None:
    if instance is None:
        return
    if "is_public" in instance.__dict__:
        return
    set_committed_value(instance, "is_public", instance.user_id is None)


class ProviderInstanceRepository(BaseRepository[ProviderInstance]):
    model = ProviderInstance

    async def has_is_public_column(self) -> bool:
        return await _has_provider_instance_is_public_column(self.session)

    async def get(self, id: uuid.UUID) -> ProviderInstance | None:
        has_is_public = await self.has_is_public_column()
        stmt = select(self.model).where(self.model.id == id)
        if not has_is_public:
            stmt = stmt.options(defer(ProviderInstance.is_public))
        result = await self.session.execute(stmt)
        instance = result.scalars().first()
        if not has_is_public:
            _apply_legacy_is_public(instance)
        return instance

    async def get_multi(self, skip: int = 0, limit: int = 100) -> list[ProviderInstance]:
        has_is_public = await self.has_is_public_column()
        stmt = select(self.model).offset(skip).limit(limit)
        if not has_is_public:
            stmt = stmt.options(defer(ProviderInstance.is_public))
        result = await self.session.execute(stmt)
        instances = list(result.scalars().all())
        if not has_is_public:
            for instance in instances:
                _apply_legacy_is_public(instance)
        return instances

    async def get_available_instances(
        self,
        user_id: str | None,
        include_public: bool = True,
    ) -> list[ProviderInstance]:
        cache_key = CacheKeys.provider_instance_list(user_id, include_public)

        async def loader() -> list[ProviderInstance]:
            has_is_public = await self.has_is_public_column()
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
                .join(
                    model_count_sq,
                    ProviderInstance.id == model_count_sq.c.instance_id,
                    isouter=True,
                )
                .where(ProviderInstance.is_enabled == True)  # noqa: E712
            )
            if not has_is_public:
                stmt = stmt.options(defer(ProviderInstance.is_public))
            user_uuid = None
            if user_id:
                try:
                    user_uuid = uuid.UUID(str(user_id))
                except Exception:
                    user_uuid = None
            if user_id is not None:
                if include_public:
                    public_clause = _public_instance_clause(has_is_public)
                    stmt = stmt.where(
                        or_(
                            ProviderInstance.user_id == user_uuid,
                            public_clause,
                        )
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
                if not has_is_public:
                    _apply_legacy_is_public(inst)
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
        cache_key = CacheKeys.provider_model_candidates(
            capability, model_id, user_id, include_public
        )
        user_uuid = None
        if user_id:
            try:
                user_uuid = uuid.UUID(str(user_id))
            except Exception:
                user_uuid = None
        if user_id is None and not include_public:
            return []

        async def loader() -> list[ProviderModel]:
            has_is_public = await _has_provider_instance_is_public_column(self.session)
            capability_candidates = expand_capabilities(capability)
            if not capability_candidates:
                return []

            # 使用 capabilities 数组包含任意候选能力的过滤逻辑
            # PostgreSQL: capabilities @> ARRAY[...]
            # SQLAlchemy: ProviderModel.capabilities.contains([capability]) + OR 组合
            stmt = (
                select(ProviderModel)
                .join(
                    ProviderInstance, ProviderModel.instance_id == ProviderInstance.id
                )
                .where(
                    # 支持对外别名 unified_model_id 作为匹配键
                    or_(
                        ProviderModel.model_id == model_id,
                        ProviderModel.unified_model_id == model_id,
                    ),
                    ProviderModel.is_active == True,  # noqa: E712
                    ProviderInstance.is_enabled == True,  # noqa: E712
                )
            )
            dialect = (
                self.session.bind.dialect.name
                if getattr(self.session, "bind", None)
                else None
            )
            if dialect == "postgresql":
                overlap_filters = [
                    ProviderModel.capabilities.contains([candidate])
                    for candidate in capability_candidates
                ]
                stmt = stmt.where(or_(*overlap_filters))

            if user_id is not None:
                if include_public:
                    public_clause = _public_instance_clause(has_is_public)
                    stmt = stmt.where(
                        or_(
                            ProviderInstance.user_id == user_uuid,
                            public_clause,
                        )
                    )
                else:
                    stmt = stmt.where(ProviderInstance.user_id == user_uuid)

            result = await self.session.execute(stmt)
            models = list(result.scalars().all())
            if dialect != "postgresql":
                candidate_set = set(capability_candidates)
                models = [
                    m
                    for m in models
                    if any(
                        expanded_cap in candidate_set
                        for cap in (m.capabilities or [])
                        for expanded_cap in expand_capabilities(cap)
                    )
                ]

            if user_uuid and models:
                instance_ids = {m.instance_id for m in models}
                owner_rows = await self.session.execute(
                    select(ProviderInstance.id, ProviderInstance.user_id).where(
                        ProviderInstance.id.in_(instance_ids)
                    )
                )
                owner_map = {str(row[0]): row[1] for row in owner_rows.all()}

                lockable_model_ids: list[uuid.UUID] = []
                for model in models:
                    unlock_price = parse_unlock_price_credits(model.pricing_config or {})
                    if requires_model_purchase(
                        instance_owner_id=owner_map.get(str(model.instance_id)),
                        user_id=user_uuid,
                        unlock_price_credits=unlock_price,
                    ):
                        lockable_model_ids.append(model.id)

                if lockable_model_ids:
                    purchased_rows = await self.session.execute(
                        select(ProviderModelEntitlement.provider_model_id).where(
                            ProviderModelEntitlement.user_id == user_uuid,
                            ProviderModelEntitlement.provider_model_id.in_(
                                lockable_model_ids
                            ),
                        )
                    )
                    purchased_ids = {row[0] for row in purchased_rows.all()}
                    lockable_id_set = set(lockable_model_ids)
                    models = [
                        model
                        for model in models
                        if model.id not in lockable_id_set
                        or model.id in purchased_ids
                    ]
            return models

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

    async def upsert_for_instance(
        self, instance_id: uuid.UUID, models_data: list[dict]
    ) -> list[ProviderModel]:
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

    async def get_available_models_for_user(self, user_id: str) -> list[str]:
        """
        获取用户可用的模型列表

        Args:
            user_id: 用户ID

        Returns:
            可用模型ID列表
        """
        try:
            user_uuid = uuid.UUID(str(user_id))
        except Exception:
            return []
        has_is_public = await _has_provider_instance_is_public_column(self.session)

        stmt = (
            select(
                ProviderModel.id,
                ProviderModel.model_id,
                ProviderModel.pricing_config,
                ProviderInstance.user_id,
            )
            .join(ProviderInstance, ProviderInstance.id == ProviderModel.instance_id)
            .where(
                or_(
                    ProviderInstance.user_id == user_uuid,
                    _public_instance_clause(has_is_public),
                )
            )
            .where(ProviderInstance.is_enabled.is_(True))
            .where(ProviderModel.is_active.is_(True))
        )
        rows = (await self.session.execute(stmt)).all()
        if not rows:
            return []

        lockable_ids: list[uuid.UUID] = []
        model_id_by_uuid: dict[str, str] = {}
        for model_uuid, model_id, pricing_config, instance_owner_id in rows:
            model_id_by_uuid[str(model_uuid)] = model_id
            unlock_price = parse_unlock_price_credits(pricing_config or {})
            if requires_model_purchase(
                instance_owner_id=instance_owner_id,
                user_id=user_uuid,
                unlock_price_credits=unlock_price,
            ):
                lockable_ids.append(model_uuid)

        purchased_ids: set[str] = set()
        if lockable_ids:
            purchased_rows = await self.session.execute(
                select(ProviderModelEntitlement.provider_model_id).where(
                    ProviderModelEntitlement.user_id == user_uuid,
                    ProviderModelEntitlement.provider_model_id.in_(lockable_ids),
                )
            )
            purchased_ids = {str(row[0]) for row in purchased_rows.all()}

        available: list[str] = []
        seen: set[str] = set()
        lockable_id_set = {str(model_uuid) for model_uuid in lockable_ids}
        for model_uuid, _, _, _ in rows:
            model_uuid_str = str(model_uuid)
            if model_uuid_str in lockable_id_set and model_uuid_str not in purchased_ids:
                continue
            model_id = model_id_by_uuid.get(model_uuid_str)
            if not model_id or model_id in seen:
                continue
            seen.add(model_id)
            available.append(model_id)
        return available

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
