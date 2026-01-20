"""
BanditRepository: 多臂赌博臂状态的读写

目标：
- 为路由选择提供最新的臂状态（成功率、冷却期）
- 记录每次上游调用反馈（成功/失败、延迟、成本、奖励）
- 支持按阈值自动进入冷却
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_invalidation import CacheInvalidator
from app.core.cache_keys import CacheKeys
from app.core.logging import logger
from app.models.bandit import BanditArmState, BanditStrategy
from app.models.provider_instance import ProviderModel, ProviderInstance
from app.models.provider_preset import ProviderPreset
from app.repositories.base import BaseRepository
from app.utils.time_utils import Datetime


class BanditRepository(BaseRepository[BanditArmState]):
    model = BanditArmState

    def __init__(self, session: AsyncSession):
        super().__init__(session, BanditArmState)
        self._cache_ttl = 60
        self._invalidator = CacheInvalidator()

    async def get_states_map(
        self, provider_model_ids: Iterable[str]
    ) -> dict[str, BanditArmState]:
        ids = list(provider_model_ids)
        if not ids:
            return {}
        cached: dict[str, BanditArmState] = {}
        missing: list[str] = []
        version = await self._invalidator.get_version()

        for pid in ids:
            payload = await cache.get_with_version(
                CacheKeys.bandit_state(pid), version
            )
            if payload:
                cached[pid] = self._deserialize_state(payload)
            else:
                missing.append(pid)

        rows: list[BanditArmState] = []
        if missing:
            missing_uuids = []
            for m in missing:
                try:
                    missing_uuids.append(uuid.UUID(m))
                except ValueError:
                    continue
            
            if missing_uuids:
                stmt = select(BanditArmState).where(BanditArmState.provider_model_id.in_(missing_uuids))
                result = await self.session.execute(stmt)
                rows = result.scalars().all()
            
            for r in rows:
                try:
                    await cache.set_with_version(
                        CacheKeys.bandit_state(str(r.provider_model_id)),
                        self._serialize_state(r),
                        version if version is not None else 0,
                        ttl=self._cache_ttl,
                    )
                except Exception as exc:
                    logger.warning(f"bandit_cache_set_failed item={r.provider_model_id} exc={exc}")
                cached[str(r.provider_model_id)] = r

        return cached

    async def ensure_state(
        self,
        provider_model_id: str,
        strategy: str | None = None,
        epsilon: float | None = None,
        alpha: float | None = None,
        beta: float | None = None,
    ) -> BanditArmState:
        """不存在则创建一个初始状态"""
        existing = await self.get_by_item(provider_model_id)
        if existing:
            return existing

        obj = BanditArmState(
            provider_model_id=provider_model_id,
            strategy=strategy or BanditStrategy.EPSILON_GREEDY.value,
            epsilon=epsilon or 0.1,
            alpha=alpha or 1.0,
            beta=beta or 1.0,
        )
        self.session.add(obj)
        await self.session.commit()
        await self.session.refresh(obj)
        # 写缓存前先提升版本，保证旧值不会复活
        version = await self._invalidator.bump_version()
        try:
            await cache.set_with_version(
                CacheKeys.bandit_state(provider_model_id),
                self._serialize_state(obj),
                version if version is not None else 0,
                ttl=self._cache_ttl,
            )
        except Exception as exc:
            logger.warning(f"bandit_cache_set_failed item={provider_model_id} exc={exc}")
        return obj

    async def get_by_item(self, provider_model_id: str) -> BanditArmState | None:
        stmt = select(BanditArmState).where(BanditArmState.provider_model_id == provider_model_id)
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def record_feedback(
        self,
        provider_model_id: str,
        success: bool,
        latency_ms: float | None,
        cost: float | None,
        reward: float | None,
        routing_config: dict | None = None,
    ) -> BanditArmState:
        """
        记录反馈并返回最新状态
        """
        rc = routing_config or {}
        state = await self.ensure_state(
            provider_model_id=provider_model_id,
            strategy=rc.get("strategy"),
            epsilon=float(rc.get("epsilon", 0.1)) if rc.get("epsilon") is not None else None,
            alpha=float(rc.get("alpha", 1.0)) if rc.get("alpha") is not None else None,
            beta=float(rc.get("beta", 1.0)) if rc.get("beta") is not None else None,
        )

        state.total_trials += 1
        if success:
            state.successes += 1
            state.failures = max(state.failures - 1, 0)  # 简单回退连续失败
        else:
            state.failures += 1

        if latency_ms is not None:
            state.total_latency_ms += int(latency_ms)
            state.latency_p95_ms = float(latency_ms)

        if cost is not None:
            state.total_cost += Decimal(str(cost))

        if reward is not None:
            state.last_reward = Decimal(str(reward))

        # 自动冷却
        fail_threshold = int(rc.get("failure_cooldown_threshold", 5))
        cooldown_seconds = int(rc.get("cooldown_seconds", 60))
        if not success and state.failures >= fail_threshold:
            state.cooldown_until = Datetime.now() + timedelta(seconds=cooldown_seconds)
        elif success:
            state.cooldown_until = None  # 成功后解除冷却

        await self.session.commit()
        await self.session.refresh(state)
        version = await self._invalidator.bump_version()
        try:
            await cache.set_with_version(
                CacheKeys.bandit_state(provider_model_id),
                self._serialize_state(state),
                version if version is not None else 0,
                ttl=self._cache_ttl,
            )
        except Exception as exc:
            logger.warning(f"bandit_cache_set_failed item={provider_model_id} exc={exc}")
        return state

    async def get_report(
        self,
        capability: str | None = None,
        model: str | None = None,
    ) -> list[dict]:
        """聚合并返回 Bandit 臂的观测数据。"""

        stmt = (
            select(
                BanditArmState,
                ProviderModel,
                ProviderInstance,
                ProviderPreset.provider.label("provider"),
            )
            .join(ProviderModel, BanditArmState.provider_model_id == ProviderModel.id)
            .join(ProviderInstance, ProviderModel.instance_id == ProviderInstance.id)
            .join(ProviderPreset, ProviderInstance.preset_slug == ProviderPreset.slug)
            .where(
                ProviderPreset.is_active == True,  # noqa: E712
                ProviderModel.is_active == True,  # noqa: E712
                ProviderInstance.is_enabled == True,  # noqa: E712
            )
        )

        if capability:
            stmt = stmt.where(ProviderModel.capabilities.contains([capability]))
        if model:
            stmt = stmt.where(ProviderModel.model_id == model)

        result = await self.session.execute(stmt)
        rows = result.all()

        total_trials = sum(r.BanditArmState.total_trials for r in rows if r.BanditArmState)

        reports: list[dict] = []
        for row in rows:
            state: BanditArmState = row.BanditArmState
            pm: ProviderModel = row.ProviderModel
            inst: ProviderInstance = row.ProviderInstance
            provider = row.provider

            trials = int(state.total_trials or 0)
            successes = int(state.successes or 0)
            failures = int(state.failures or 0)
            success_rate = (successes / trials) if trials else 0.0
            avg_latency = (float(state.total_latency_ms) / trials) if trials else 0.0
            selection_ratio = (trials / total_trials) if total_trials else 0.0

            reports.append(
                {
                    "instance_id": str(pm.instance_id),
                    "provider_model_id": str(pm.id),
                    "provider": provider,
                    "capability": pm.capabilities[0] if pm.capabilities else "chat",
                    "model": pm.model_id,
                    "strategy": state.strategy,
                    "epsilon": state.epsilon,
                    "alpha": state.alpha,
                    "beta": state.beta,
                    "total_trials": trials,
                    "successes": successes,
                    "success_rate": success_rate,
                    "failures": failures,
                    "selection_ratio": selection_ratio,
                    "avg_latency_ms": avg_latency,
                    "latency_p95_ms": float(state.latency_p95_ms)
                    if state.latency_p95_ms is not None
                    else None,
                    "total_cost": float(state.total_cost),
                    "last_reward": float(state.last_reward),
                    "cooldown_until": state.cooldown_until,
                    "weight": int(item.weight or 0),
                    "priority": int(item.priority or 0),
                    "version": state.version,
                }
            )

        return reports

    @staticmethod
    def _serialize_state(state: BanditArmState) -> dict:
        return {
            "preset_item_id": str(state.preset_item_id),
            "strategy": state.strategy,
            "epsilon": state.epsilon,
            "alpha": state.alpha,
            "beta": state.beta,
            "total_trials": int(state.total_trials),
            "successes": int(state.successes),
            "failures": int(state.failures),
            "total_latency_ms": int(state.total_latency_ms),
            "latency_p95_ms": float(state.latency_p95_ms) if state.latency_p95_ms is not None else None,
            "total_cost": float(state.total_cost),
            "last_reward": float(state.last_reward),
            "cooldown_until": state.cooldown_until,
            "version": state.version,
        }

    @staticmethod
    def _deserialize_state(payload: dict) -> BanditArmState:
        obj = BanditArmState(
            preset_item_id=uuid.UUID(str(payload["preset_item_id"])),
            strategy=payload.get("strategy"),
            epsilon=payload.get("epsilon", 0.1),
            alpha=payload.get("alpha", 1.0),
            beta=payload.get("beta", 1.0),
            total_trials=payload.get("total_trials", 0),
            successes=payload.get("successes", 0),
            failures=payload.get("failures", 0),
            total_latency_ms=payload.get("total_latency_ms", 0),
            latency_p95_ms=payload.get("latency_p95_ms"),
            total_cost=Decimal(str(payload.get("total_cost", 0))),
            last_reward=Decimal(str(payload.get("last_reward", 0))),
            version=payload.get("version", 1),
        )
        obj.cooldown_until = payload.get("cooldown_until")
        return obj

    async def lift_cooldown(self, preset_item_id: str) -> None:
        stmt = (
            update(BanditArmState)
            .where(BanditArmState.preset_item_id == preset_item_id)
            .values(cooldown_until=None)
        )
        await self.session.execute(stmt)
        await self.session.commit()

    @staticmethod
    def in_cooldown(state: BanditArmState | None) -> bool:
        if not state or not state.cooldown_until:
            return False
        return state.cooldown_until > Datetime.now()
