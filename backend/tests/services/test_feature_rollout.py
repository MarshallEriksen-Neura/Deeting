import pytest

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.services.system import FeatureRollout


class DummyRedis:
    def __init__(self, values: dict[str, str] | None = None, sets: dict[str, set[str]] | None = None) -> None:
        self._values = values or {}
        self._sets = sets or {}

    async def get(self, key: str):
        return self._values.get(key)

    async def sismember(self, key: str, member: str):
        return member in self._sets.get(key, set())


@pytest.mark.asyncio
async def test_feature_rollout_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cache, "_redis", None)
    rollout = FeatureRollout(cfg_ttl_seconds=0.0)
    assert await rollout.is_enabled("memory_read", subject_id="u1") is False


@pytest.mark.asyncio
async def test_feature_rollout_enabled_all(monkeypatch: pytest.MonkeyPatch) -> None:
    values = {
        CacheKeys.feature_rollout_enabled("memory_read"): "1",
        CacheKeys.feature_rollout_ratio("memory_read"): "1",
    }
    monkeypatch.setattr(cache, "_redis", DummyRedis(values=values))
    rollout = FeatureRollout(cfg_ttl_seconds=0.0)
    assert await rollout.is_enabled("memory_read", subject_id="u1") is True


@pytest.mark.asyncio
async def test_feature_rollout_allowlist(monkeypatch: pytest.MonkeyPatch) -> None:
    values = {
        CacheKeys.feature_rollout_enabled("memory_read"): "1",
        CacheKeys.feature_rollout_ratio("memory_read"): "0",
    }
    sets = {
        CacheKeys.feature_rollout_allowlist("memory_read"): {"user-1"},
    }
    monkeypatch.setattr(cache, "_redis", DummyRedis(values=values, sets=sets))
    rollout = FeatureRollout(cfg_ttl_seconds=0.0)
    assert await rollout.is_enabled("memory_read", subject_id="user-1") is True
    assert await rollout.is_enabled("memory_read", subject_id="user-2") is False
