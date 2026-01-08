"""
RoutingSelector: 统一的路由选择与降级策略

职责：
- 从 ProviderPreset/Item 中筛选可用上游（按 capability/model/channel/is_active）
- 支持权重/优先级选择
- 支持简单 epsilon-greedy bandit（占位实现，后续可接入实时反馈）
- 支持灰度比例（gray_ratio）及备份列表用于熔断降级
"""

from __future__ import annotations

import logging
import math
import random
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_invalidation import CacheInvalidator
from app.core.cache_keys import CacheKeys
from app.models.bandit import BanditArmState
from app.repositories.bandit_repository import BanditRepository
from app.repositories.provider_preset_repository import (
    ProviderPresetItemRepository,
    ProviderPresetRepository,
)

logger = logging.getLogger(__name__)


@dataclass
class RoutingCandidate:
    preset_id: str
    preset_item_id: str
    provider: str
    upstream_url: str
    channel: str
    template_engine: str
    request_template: dict
    response_transform: dict
    pricing_config: dict
    limit_config: dict
    auth_type: str
    auth_config: dict
    default_headers: dict
    default_params: dict
    routing_config: dict
    weight: int
    priority: int
    bandit_state: BanditArmState | None = None


class RoutingSelector:
    """封装路由选择逻辑，便于在步骤中复用/测试。"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.preset_repo = ProviderPresetRepository(session)
        self.item_repo = ProviderPresetItemRepository(session)
        self.bandit_repo = BanditRepository(session)
        self._invalidator = CacheInvalidator()
        self._cache_ttl = 60

    async def load_candidates(
        self,
        capability: str,
        model: str,
        channel: str,
        allowed_providers: set[str] | None = None,
        allowed_presets: set[str] | None = None,
        allowed_preset_items: set[str] | None = None,
    ) -> list[RoutingCandidate]:
        version = await self._invalidator.get_version()
        cache_key = CacheKeys.preset_routing(
            capability,
            model,
            channel,
            providers=list(allowed_providers or []),
            presets=list(allowed_presets or []),
            preset_items=list(allowed_preset_items or []),
        )

        async def _load_from_db() -> list[dict]:
            presets = await self.preset_repo.get_active_presets()
            results: list[dict] = []
            for preset in presets:
                if allowed_presets and str(preset.id) not in allowed_presets:
                    continue
                if allowed_providers and preset.provider not in allowed_providers:
                    continue

                # 优先按 unified_model_id 匹配，找不到再回退 model
                items = await self.item_repo.get_by_capability(
                    preset_id=str(preset.id),
                    capability=capability,
                    unified_model_id=model,
                    channel=channel,
                )
                if not items:
                    items = await self.item_repo.get_by_capability(
                        preset_id=str(preset.id),
                        capability=capability,
                        model=model,
                        channel=channel,
                    )
                for item in items:
                    if allowed_preset_items and str(item.id) not in allowed_preset_items:
                        continue
                    # 外部通道仅允许 public/shared
                    if channel == "external" and item.visibility not in {"public", "shared"}:
                        continue
                    results.append(
                        {
                            "preset_id": str(preset.id),
                            "preset_item_id": str(item.id),
                            "provider": preset.provider,
                            "upstream_url": f"{preset.base_url.rstrip('/')}/{item.upstream_path.lstrip('/')}",
                            "channel": item.channel or "external",
                            "template_engine": item.template_engine or "simple_replace",
                            "request_template": item.request_template or {},
                            "response_transform": item.response_transform or {},
                            "pricing_config": item.pricing_config or {},
                            "limit_config": item.limit_config or {},
                            "auth_type": preset.auth_type,
                            "auth_config": preset.auth_config or {},
                            "default_headers": preset.default_headers or {},
                            "default_params": preset.default_params or {},
                            "routing_config": item.routing_config or {},
                            "weight": int(item.weight or 0),
                            "priority": int(item.priority or 0),
                        }
                    )
            return results

        payload = await cache.get_or_set_singleflight(
            cache_key,
            loader=_load_from_db,
            ttl=self._cache_ttl,
            version=version,
        )

        raw_candidates: list[dict] = payload or []
        candidates: list[RoutingCandidate] = []
        preset_item_ids: list[str] = [c["preset_item_id"] for c in raw_candidates]
        states: dict[str, BanditArmState] = {}

        if preset_item_ids:
            states = await self.bandit_repo.get_states_map(preset_item_ids)

        for data in raw_candidates:
            state = states.get(data["preset_item_id"])
            if BanditRepository.in_cooldown(state):
                continue
            candidates.append(
                RoutingCandidate(
                    preset_id=data["preset_id"],
                    preset_item_id=data["preset_item_id"],
                    provider=data["provider"],
                    upstream_url=data["upstream_url"],
                    channel=data["channel"],
                    template_engine=data["template_engine"],
                    request_template=data["request_template"],
                    response_transform=data["response_transform"],
                    pricing_config=data["pricing_config"],
                    limit_config=data["limit_config"],
                    auth_type=data["auth_type"],
                    auth_config=data["auth_config"],
                    default_headers=data["default_headers"],
                    default_params=data["default_params"],
                    routing_config=data["routing_config"],
                    weight=data["weight"],
                    priority=data["priority"],
                    bandit_state=state,
                )
            )

        return candidates

    def _apply_gray(
        self,
        candidates: list[RoutingCandidate],
    ) -> list[RoutingCandidate]:
        """
        灰度：当 routing_config.gray_ratio 存在时，按比例随机挑选。
        约定 gray_ratio 0-1，gray_tag 可选（用于未来更精细分组，当前仅作为标记）。
        """
        if not candidates:
            return candidates

        gray_enabled = [
            c for c in candidates if c.routing_config.get("gray_ratio") is not None
        ]
        if not gray_enabled:
            return candidates

        selected: list[RoutingCandidate] = []
        for c in candidates:
            ratio = c.routing_config.get("gray_ratio")
            if ratio is None:
                selected.append(c)
                continue
            try:
                ratio_val = float(ratio)
            except (TypeError, ValueError):
                selected.append(c)
                continue
            if ratio_val <= 0:
                continue  # 灰度关闭
            if ratio_val >= 1 or random.random() < ratio_val:
                selected.append(c)
        return selected or candidates  # 灰度全被过滤时回退原列表

    def _weighted_choice(self, candidates: list[RoutingCandidate]) -> RoutingCandidate:
        """按照 priority 分组后在最高优先级内按权重随机选择。"""
        if not candidates:
            raise ValueError("no candidates available")

        # 仅在最高优先级层内做随机
        max_pri = max(c.priority for c in candidates)
        same_pri = [c for c in candidates if c.priority == max_pri]
        weights = [max(c.weight, 0) or 1 for c in same_pri]
        return random.choices(same_pri, weights=weights, k=1)[0]

    def _bandit_choice(
        self,
        candidates: list[RoutingCandidate],
        routing_config: dict,
    ) -> RoutingCandidate:
        """
        根据 strategy 选择 bandit 算法，默认 epsilon-greedy。
        无状态时退回权重选择。
        """
        strategy = routing_config.get("strategy", "epsilon_greedy")

        if strategy == "ucb1":
            return self._ucb_choice(candidates)
        if strategy == "thompson":
            return self._thompson_choice(candidates)
        if strategy not in {"epsilon_greedy", "bandit"}:
            logger.warning(f"unknown_bandit_strategy={strategy}, fallback_weighted")
            return self._weighted_choice(candidates)

        # 默认 epsilon-greedy
        epsilon = float(routing_config.get("epsilon", 0.1))
        if random.random() < epsilon:
            return random.choice(candidates)

        def score(c: RoutingCandidate) -> float:
            state = c.bandit_state
            if state and state.total_trials > 0:
                success_rate = state.successes / state.total_trials
                latency_penalty = 0.0
                if state.latency_p95_ms:
                    target = float(routing_config.get("latency_target_ms", 3000))
                    latency_penalty = min(state.latency_p95_ms / max(target, 1.0), 1.5) * 0.2
                return success_rate - latency_penalty + float(c.weight or 0) * 0.0001
            return float(c.weight or 1)

        return max(candidates, key=score)

    def _ucb_choice(self, candidates: list[RoutingCandidate]) -> RoutingCandidate:
        """
        UCB1：score = p_hat + sqrt(2 ln N / n)
        若某臂未试过则优先选择该臂。
        """
        explored = [c for c in candidates if c.bandit_state and c.bandit_state.total_trials > 0]
        if len(explored) < len(candidates):
            # 存在未试臂，直接返回首个未试臂（可随机）
            for c in candidates:
                if not c.bandit_state or c.bandit_state.total_trials == 0:
                    return c

        total_trials = sum(c.bandit_state.total_trials for c in explored) or 1

        def ucb_score(c: RoutingCandidate) -> float:
            s = c.bandit_state
            if not s or s.total_trials == 0:
                return float("inf")
            mean = s.successes / s.total_trials
            bonus = math.sqrt(2 * math.log(total_trials) / s.total_trials)
            return mean + bonus

        return max(candidates, key=ucb_score)

    def _thompson_choice(self, candidates: list[RoutingCandidate]) -> RoutingCandidate:
        """
        Thompson Sampling：对每个臂采样 Beta(alpha + success, beta + failure)
        未有状态时回退权重选择。
        """
        samples: list[tuple[float, RoutingCandidate]] = []
        for c in candidates:
            s = c.bandit_state
            if not s:
                return self._weighted_choice(candidates)
            alpha = (s.alpha or 1.0) + s.successes
            beta = (s.beta or 1.0) + s.failures
            if alpha <= 0 or beta <= 0:
                logger.warning("invalid_beta_params alpha=%s beta=%s, fallback_weighted", alpha, beta)
                return self._weighted_choice(candidates)
            samples.append((random.betavariate(alpha, beta), c))
        return max(samples, key=lambda x: x[0])[1]

    def choose(
        self,
        candidates: list[RoutingCandidate],
    ) -> tuple[RoutingCandidate, list[RoutingCandidate]]:
        """
        选择主路由与备份路由列表。
        备份按 priority desc + weight desc 排序，用于熔断降级。
        """
        if not candidates:
            raise ValueError("no candidates available")

        candidates = self._apply_gray(candidates)

        # 优先读取全局 routing_config（取第一条的配置；实际生产可按业务决定来源）
        routing_config = candidates[0].routing_config or {}
        strategy = routing_config.get("strategy", "weight")

        if strategy == "bandit":
            primary = self._bandit_choice(candidates, routing_config)
        else:
            primary = self._weighted_choice(candidates)

        # 备份列表：去掉主路由后按 priority / weight 排序
        backups = [
            c
            for c in sorted(
                candidates,
                key=lambda c: (c.priority, c.weight),
                reverse=True,
            )
            if c.preset_item_id != primary.preset_item_id
        ]

        return primary, backups
