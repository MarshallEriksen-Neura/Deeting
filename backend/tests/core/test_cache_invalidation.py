import asyncio
from unittest.mock import ANY, AsyncMock

import pytest

from app.core.cache import cache
from app.core.cache_invalidation import CacheInvalidator
from app.core.cache_keys import CacheKeys


class FakeRedis:
    """Minimal Redis stub for singleflight tests."""

    def __init__(self):
        self.store: dict[str, bytes] = {}

    def _make_key(self, key: str) -> str:
        return key

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value, ex=None, nx=False):
        if nx and key in self.store:
            return False
        self.store[key] = value if isinstance(value, (bytes, bytearray)) else value
        return True

    async def incr(self, key: str):
        val = int(self.store.get(key, b"0"))
        val += 1
        self.store[key] = str(val).encode()
        return val

    async def delete(self, *keys):
        for k in keys:
            self.store.pop(k, None)
        return True

    async def unlink(self, *keys):
        return await self.delete(*keys)

    async def keys(self, pattern: str):
        # Simple prefix match: pattern like "ai_gateway:preset:*"
        if not pattern.endswith("*"):
            return []
        prefix = pattern[:-1]
        return [k for k in self.store.keys() if k.startswith(prefix)]


@pytest.mark.asyncio
async def test_preset_updated_triggers_key_deletion_and_version(monkeypatch):
    redis = AsyncMock()
    version_key = cache._make_key(CacheKeys.cfg_version())
    updated_at_key = cache._make_key(CacheKeys.cfg_updated_at())

    # unlink for direct keys + prefix clears
    redis.unlink = AsyncMock()
    redis.keys = AsyncMock(side_effect=lambda pattern: [f"{cache._make_key('preset:')}1"] if "preset:" in pattern else [])
    redis.incr = AsyncMock(return_value=3)
    redis.set = AsyncMock(return_value=True)
    monkeypatch.setattr(cache, "_redis", redis)

    invalidator = CacheInvalidator()
    await invalidator.on_preset_updated("123")

    # direct pricing/limit deletion
    assert redis.unlink.call_count >= 1
    called_args = [args for call in redis.unlink.call_args_list for args in call[0]]
    assert cache._make_key(CacheKeys.pricing("123")) in called_args
    assert cache._make_key(CacheKeys.limit("123")) in called_args

    # version bumped and timestamp written
    redis.incr.assert_called_with(version_key)
    redis.set.assert_any_call(updated_at_key, ANY, ex=24 * 3600)


@pytest.mark.asyncio
async def test_singleflight_returns_same_value_and_loader_once(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(cache, "_redis", fake)

    call_count = 0

    async def loader():
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return "value"

    key = CacheKeys.preset_routing("chat", "gpt-4o", "external")
    version = 1

    r1, r2 = await asyncio.gather(
        cache.get_or_set_singleflight(key, loader=loader, ttl=30, version=version),
        cache.get_or_set_singleflight(key, loader=loader, ttl=30, version=version),
    )

    assert r1 == r2 == "value"
    assert call_count == 1

    # subsequent read should hit cache without loader
    r3 = await cache.get_or_set_singleflight(key, loader=loader, ttl=30, version=version)
    assert r3 == "value"
    assert call_count == 1


@pytest.mark.asyncio
async def test_get_with_version_mismatch_triggers_reload(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(cache, "_redis", fake)

    key = CacheKeys.preset_routing("chat", "gpt-4o", "external")

    # write stale version
    await cache.set_with_version(key, {"foo": "old"}, version=1, ttl=30)

    async def loader():
        return {"foo": "new"}

    result = await cache.get_or_set_singleflight(key, loader=loader, ttl=30, version=2)
    assert result["foo"] == "new"
