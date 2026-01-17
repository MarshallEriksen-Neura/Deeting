"""
RoutingSelector: 统一的路由选择与降级策略

职责：
- 在 BYOP 架构下，从 ProviderInstance/ProviderModel 中筛选可用上游（按 capability/model/is_active）
- 支持权重/优先级选择
- 支持灰度比例（gray_ratio）及备份列表用于熔断降级
"""

from __future__ import annotations

import logging
import math
import random
import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bandit import BanditArmState
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.repositories.provider_instance_repository import (
    ProviderInstanceRepository,
    ProviderModelRepository,
)
from app.repositories.bandit_repository import BanditRepository
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.repositories.provider_credential_repository import ProviderCredentialRepository
from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class RoutingCandidate:
    preset_id: str | None
    instance_id: str
    preset_item_id: str  # 兼容旧字段，实际存 provider_model.id
    model_id: str
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
    credential_id: str | None = None
    credential_alias: str | None = None
    bandit_state: BanditArmState | None = None


class RoutingSelector:
    """封装路由选择逻辑，便于在步骤中复用/测试。"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.preset_repo = ProviderPresetRepository(session)
        self.instance_repo = ProviderInstanceRepository(session)
        self.model_repo = ProviderModelRepository(session)
        self.credential_repo = ProviderCredentialRepository(session)
        self.bandit_repo = BanditRepository(session)

    async def load_candidates(
        self,
        capability: str,
        model: str,
        channel: str,
        user_id: str | None = None,
        include_public: bool = True,
        allowed_providers: set[str] | None = None,
    ) -> list[RoutingCandidate]:
        results: list[RoutingCandidate] = []

        instances = await self.instance_repo.get_available_instances(user_id=user_id, include_public=include_public)
        if not instances:
            return results

        # 模型列表一次查询
        models = await self.model_repo.get_candidates(
            capability=capability,
            model_id=model,
            user_id=str(user_id) if user_id else None,
            include_public=include_public,
        )
        models_by_instance = {}
        for m in models:
            models_by_instance.setdefault(str(m.instance_id), []).append(m)

        # 预拉取模板，按 slug 缓存
        presets_by_slug = {}

        # 预取实例凭证（多 Key）
        credentials_map = await self.credential_repo.get_by_instance_ids([str(i.id) for i in instances])

        for instance in instances:
            instance_models = models_by_instance.get(str(instance.id), [])
            if not instance_models:
                continue

            preset = presets_by_slug.get(instance.preset_slug)
            if preset is None:
                preset = await self.preset_repo.get_by_slug(instance.preset_slug)
                presets_by_slug[instance.preset_slug] = preset
            if not preset or not preset.is_active:
                continue
            if allowed_providers and preset.provider not in allowed_providers:
                continue

            # 为该实例准备可用凭证列表：默认 credentials_ref + 额外 provider_credential
            cred_entries: list[dict] = []
            if instance.credentials_ref:
                cred_entries.append(
                    {
                        "id": None,
                        "alias": "default",
                        "secret_ref": instance.credentials_ref,
                        "weight": 0,
                        "priority": 0,
                    }
                )
            extra_creds = credentials_map.get(str(instance.id), [])
            for cred in extra_creds:
                cred_entries.append(
                    {
                        "id": str(cred.id),
                        "alias": cred.alias,
                        "secret_ref": cred.secret_ref_id,
                        "weight": int(cred.weight or 0),
                        "priority": int(cred.priority or 0),
                    }
                )

            if not cred_entries:
                continue  # 无可用密钥跳过

            for m in instance_models:
                base_url = instance.base_url or ""
                upstream_url = f"{base_url.rstrip('/')}/{m.upstream_path.lstrip('/')}"

                for cred in cred_entries:
                    auth_config = dict((preset.auth_config or {})) if preset else {}
                    auth_config["secret_ref_id"] = cred["secret_ref"]
                    auth_config["provider"] = preset.provider if preset else None

                    results.append(
                        RoutingCandidate(
                            preset_id=str(preset.id) if preset else None,
                            instance_id=str(instance.id),
                            preset_item_id=None,
                            model_id=str(m.id),
                            provider=preset.provider if preset else "custom",
                            upstream_url=upstream_url,
                            channel=channel,
                            template_engine=m.template_engine or "simple_replace",
                            request_template=m.request_template or {},
                            response_transform=m.response_transform or {},
                            pricing_config=m.pricing_config or {},
                            limit_config=m.limit_config or {},
                            auth_type=preset.auth_type if preset else "bearer",
                            auth_config=auth_config,
                            default_headers=preset.default_headers if preset else {},
                            default_params=preset.default_params if preset else {},
                            routing_config=m.routing_config or {},
                            weight=int(m.weight or 0) + int(cred["weight"] or 0),
                            priority=int(m.priority or 0) + int(cred["priority"] or 0),
                            credential_id=cred["id"],
                            credential_alias=cred["alias"],
                            bandit_state=None,  # Bandit 状态后续填充
                        )
                    )

        # 填充 bandit 状态
        if results:
            states = await self.bandit_repo.get_states_map([c.model_id for c in results])
            for c in results:
                c.bandit_state = states.get(c.model_id)

        return results

    async def load_candidates_by_provider_model_id(
        self,
        provider_model_id: str,
        capability: str | None,
        channel: str,
        user_id: str | None = None,
        include_public: bool = True,
        allowed_providers: set[str] | None = None,
    ) -> list[RoutingCandidate]:
        results: list[RoutingCandidate] = []

        try:
            model_uuid = uuid.UUID(str(provider_model_id))
        except Exception:
            return results

        model = await self.model_repo.get(model_uuid)
        if not model or not model.is_active:
            return results
        if capability and model.capability != capability:
            return results

        instance = await self.instance_repo.get(model.instance_id)
        if not instance or not instance.is_enabled:
            return results

        if user_id is not None:
            try:
                user_uuid = uuid.UUID(str(user_id))
            except Exception:
                user_uuid = None
            if user_uuid:
                if include_public:
                    if instance.user_id not in {user_uuid, None}:
                        return results
                else:
                    if instance.user_id != user_uuid:
                        return results

        preset = await self.preset_repo.get_by_slug(instance.preset_slug)
        if not preset or not preset.is_active:
            return results
        if allowed_providers and preset.provider not in allowed_providers:
            return results

        credentials_map = await self.credential_repo.get_by_instance_ids([str(instance.id)])
        cred_entries: list[dict] = []
        if instance.credentials_ref:
            cred_entries.append(
                {
                    "id": None,
                    "alias": "default",
                    "secret_ref": instance.credentials_ref,
                    "weight": 0,
                    "priority": 0,
                }
            )
        extra_creds = credentials_map.get(str(instance.id), [])
        for cred in extra_creds:
            cred_entries.append(
                {
                    "id": str(cred.id),
                    "alias": cred.alias,
                    "secret_ref": cred.secret_ref_id,
                    "weight": int(cred.weight or 0),
                    "priority": int(cred.priority or 0),
                }
            )

        if not cred_entries:
            return results

        base_url = instance.base_url or ""
        upstream_url = f"{base_url.rstrip('/')}/{model.upstream_path.lstrip('/')}"

        for cred in cred_entries:
            auth_config = dict((preset.auth_config or {})) if preset else {}
            auth_config["secret_ref_id"] = cred["secret_ref"]
            auth_config["provider"] = preset.provider if preset else None

            results.append(
                RoutingCandidate(
                    preset_id=str(preset.id) if preset else None,
                    instance_id=str(instance.id),
                    preset_item_id=None,
                    model_id=str(model.id),
                    provider=preset.provider if preset else "custom",
                    upstream_url=upstream_url,
                    channel=channel,
                    template_engine=model.template_engine or "simple_replace",
                    request_template=model.request_template or {},
                    response_transform=model.response_transform or {},
                    pricing_config=model.pricing_config or {},
                    limit_config=model.limit_config or {},
                    auth_type=preset.auth_type if preset else "bearer",
                    auth_config=auth_config,
                    default_headers=preset.default_headers if preset else {},
                    default_params=preset.default_params if preset else {},
                    routing_config=model.routing_config or {},
                    weight=int(model.weight or 0) + int(cred["weight"] or 0),
                    priority=int(model.priority or 0) + int(cred["priority"] or 0),
                    credential_id=cred["id"],
                    credential_alias=cred["alias"],
                    bandit_state=None,
                )
            )

        if results:
            states = await self.bandit_repo.get_states_map([c.model_id for c in results])
            for c in results:
                c.bandit_state = states.get(c.model_id)

        return results

    # ===== 前缀亲和（KV Cache 命中优化） =====
    async def _compute_prefix_fingerprint(self, messages: list[dict] | None) -> str | None:
        """
        基于请求 messages 计算前缀指纹，用于亲和路由。
        - 取前缀比例（默认 70%）并截断最大字符数，避免键过长
        - 返回 SHA256 hex；若无消息则返回 None
        """
        if not settings.AFFINITY_ROUTING_ENABLED:
            return None
        if not messages:
            return None
        try:
            import hashlib
            import json

            ratio = max(0.1, min(1.0, float(settings.AFFINITY_ROUTING_PREFIX_RATIO)))
            max_chars = max(256, int(settings.AFFINITY_ROUTING_MAX_PREFIX_CHARS))

            # 简化：把 messages 序列化后截取前缀
            payload = json.dumps(messages, ensure_ascii=False, separators=(",", ":"))
            cutoff = min(len(payload), int(len(payload) * ratio), max_chars)
            prefix = payload[:cutoff]
            return hashlib.sha256(prefix.encode("utf-8")).hexdigest()
        except Exception:
            return None

    async def _get_affinity_provider(self, messages: list[dict] | None) -> str | None:
        if not settings.AFFINITY_ROUTING_ENABLED:
            return None
        fp = await self._compute_prefix_fingerprint(messages)
        if not fp:
            return None
        return await cache.get(CacheKeys.routing_affinity(fp))

    async def _set_affinity_provider(self, messages: list[dict] | None, provider_model_id: str) -> None:
        if not settings.AFFINITY_ROUTING_ENABLED:
            return
        fp = await self._compute_prefix_fingerprint(messages)
        if not fp:
            return
        ttl = max(30, int(settings.AFFINITY_ROUTING_TTL_SECONDS))
        try:
            await cache.set(CacheKeys.routing_affinity(fp), provider_model_id, ttl=ttl)
        except Exception:
            logger.debug("affinity_cache_set_failed", exc_info=True)

    async def _clear_affinity(self, messages: list[dict] | None, provider_model_id: str | None = None) -> None:
        if not settings.AFFINITY_ROUTING_ENABLED:
            return
        fp = await self._compute_prefix_fingerprint(messages)
        if not fp:
            return
        try:
            key = CacheKeys.routing_affinity(fp)
            if provider_model_id:
                current = await cache.get(key)
                if current != provider_model_id:
                    return
            await cache.delete(key)
        except Exception:
            logger.debug("affinity_cache_clear_failed", exc_info=True)

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
        affinity_provider_id: str | None = None,
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
            affinity_bonus = 0.0
            if affinity_provider_id and affinity_provider_id == c.model_id and state and state.total_trials >= 0:
                affinity_bonus = float(settings.AFFINITY_ROUTING_BONUS or 0.0)
            if state and state.total_trials > 0:
                success_rate = state.successes / state.total_trials
                latency_penalty = 0.0
                if state.latency_p95_ms:
                    target = float(routing_config.get("latency_target_ms", 3000))
                    latency_penalty = min(state.latency_p95_ms / max(target, 1.0), 1.5) * 0.2
                return success_rate - latency_penalty + float(c.weight or 0) * 0.0001 + affinity_bonus
            return float(c.weight or 1) + affinity_bonus

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

    async def choose(
        self,
        candidates: list[RoutingCandidate],
        messages: list[dict] | None = None,
    ) -> tuple[RoutingCandidate, list[RoutingCandidate], bool]:
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

        affinity_provider_id = None
        if strategy == "bandit":
            affinity_provider_id = await self._get_affinity_provider(messages)
            primary = self._bandit_choice(candidates, routing_config, affinity_provider_id)
        else:
            primary = self._weighted_choice(candidates)

        affinity_hit = bool(affinity_provider_id and affinity_provider_id == primary.model_id)

        # 备份列表：去掉主路由后按 priority / weight 排序
        backups = [
            c
            for c in sorted(
                candidates,
                key=lambda c: (c.priority, c.weight),
                reverse=True,
            )
            if c != primary
        ]

        return primary, backups, affinity_hit
