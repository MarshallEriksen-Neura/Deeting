from collections import defaultdict

import pytest

from app.core.cache import cache
from app.services.proxy_pool import ProxyPool


class FakeRedis:
    def __init__(self) -> None:
        self.kv: dict[str, str] = {}
        self.sets: defaultdict[str, set[str]] = defaultdict(set)

    async def get(self, key: str):
        return self.kv.get(key)

    async def set(self, key: str, value, ex: int | None = None, nx: bool | None = None):
        if nx and key in self.kv:
            return False
        self.kv[key] = value
        return True

    async def delete(self, key: str):
        self.kv.pop(key, None)
        self.sets.pop(key, None)

    async def sadd(self, key: str, *values: str):
        self.sets[key].update(values)
        return len(values)

    async def srem(self, key: str, value: str):
        self.sets[key].discard(value)
        return 1

    async def srandmember(self, key: str):
        values = self.sets.get(key, set())
        if not values:
            return None
        return next(iter(values))

    async def smembers(self, key: str):
        return set(self.sets.get(key, set()))

    async def exists(self, key: str):
        return 1 if key in self.kv else 0


@pytest.mark.asyncio
async def test_proxy_pool_returns_none_when_disabled(monkeypatch):
    fake = FakeRedis()
    await fake.set("proxy_pool:config:enabled", "0")
    pool = ProxyPool()
    monkeypatch.setattr(cache, "_redis", fake)

    result = await pool.pick()

    assert result is None


@pytest.mark.asyncio
async def test_proxy_pool_pick_and_report_failure(monkeypatch):
    fake = FakeRedis()
    await fake.set("proxy_pool:config:enabled", "1")
    endpoint_id = "ep-1"
    proxy_url = "http://127.0.0.1:8080"
    await fake.set(f"proxy_pool:endpoint:{endpoint_id}:url", proxy_url)
    await fake.sadd("proxy_pool:available", endpoint_id)

    pool = ProxyPool()
    monkeypatch.setattr(cache, "_redis", fake)

    selection = await pool.pick()
    assert selection
    assert selection.url == proxy_url
    assert selection.endpoint_id == endpoint_id

    await pool.report_failure(endpoint_id)

    assert endpoint_id not in await fake.smembers("proxy_pool:available")
    assert await fake.exists(f"proxy_pool:cooldown:{endpoint_id}") == 1
