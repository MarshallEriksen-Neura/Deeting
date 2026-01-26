from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass

from app.core.cache import cache
from app.core.cache_keys import CacheKeys


@dataclass(slots=True, frozen=True)
class FeatureRolloutConfig:
    enabled: bool
    ratio: float | None


class FeatureRollout:
    """
    系统级灰度开关：
    - enabled: 总开关
    - ratio: 0~1，按 subject_id 稳定分桶
    - allowlist: 允许特定 subject_id 直接开启
    """

    def __init__(self, *, cfg_ttl_seconds: float = 5.0) -> None:
        self._cfg_ttl_seconds = cfg_ttl_seconds
        self._cfg_cache_until: float = 0.0
        self._cfg_cache: dict[str, FeatureRolloutConfig] = {}

    async def is_enabled(self, feature: str, *, subject_id: str | None = None) -> bool:
        if not feature:
            return False
        config = await self._get_config(feature)
        if not config.enabled:
            return False

        redis = getattr(cache, "_redis", None)
        if redis and subject_id:
            try:
                allow_key = CacheKeys.feature_rollout_allowlist(feature)
                if await redis.sismember(allow_key, subject_id):
                    return True
            except Exception:
                pass

        ratio = config.ratio
        if ratio is None:
            return True
        if ratio <= 0:
            return False
        if ratio >= 1:
            return True
        if not subject_id:
            return False
        return self._hash_ratio(feature, subject_id) < ratio

    async def _get_config(self, feature: str) -> FeatureRolloutConfig:
        now = time.monotonic()
        cached = self._cfg_cache.get(feature)
        if cached and now < self._cfg_cache_until:
            return cached

        redis = getattr(cache, "_redis", None)
        if not redis:
            return FeatureRolloutConfig(enabled=False, ratio=0.0)

        try:
            enabled_raw = await redis.get(CacheKeys.feature_rollout_enabled(feature))
            ratio_raw = await redis.get(CacheKeys.feature_rollout_ratio(feature))
        except Exception:
            return FeatureRolloutConfig(enabled=False, ratio=0.0)

        enabled = self._parse_bool(enabled_raw)
        ratio = self._parse_ratio(ratio_raw)

        config = FeatureRolloutConfig(enabled=enabled, ratio=ratio)
        self._cfg_cache[feature] = config
        self._cfg_cache_until = now + self._cfg_ttl_seconds
        return config

    @staticmethod
    def _parse_bool(raw: object | None) -> bool:
        if raw is None:
            return False
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="ignore")
        value = str(raw).strip().lower()
        return value in {"1", "true", "yes", "y"}

    @staticmethod
    def _parse_ratio(raw: object | None) -> float | None:
        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="ignore")
        try:
            ratio = float(str(raw).strip())
        except (TypeError, ValueError):
            return None
        return max(0.0, min(1.0, ratio))

    @staticmethod
    def _hash_ratio(feature: str, subject_id: str) -> float:
        digest = hashlib.sha256(f"{feature}:{subject_id}".encode("utf-8")).hexdigest()
        bucket = int(digest[:8], 16)
        return bucket / 0xFFFFFFFF


feature_rollout = FeatureRollout()


__all__ = ["FeatureRollout", "FeatureRolloutConfig", "feature_rollout"]
