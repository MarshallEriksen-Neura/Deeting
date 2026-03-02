import time

import pytest

from app.services.providers.health_monitor import HealthMonitorService


class FakeRedis:
    def __init__(self):
        self.hash_store: dict[str, dict[bytes, object]] = {}
        self.store: dict[str, object] = {}

    async def hset(self, key: str, mapping: dict):
        bucket = self.hash_store.setdefault(key, {})
        for field, value in mapping.items():
            field_key = field if isinstance(field, bytes) else str(field).encode()
            bucket[field_key] = value
        return True

    async def hgetall(self, key: str):
        return self.hash_store.get(key, {}).copy()

    async def hget(self, key: str, field: str):
        bucket = self.hash_store.get(key, {})
        field_key = field if isinstance(field, bytes) else str(field).encode()
        return bucket.get(field_key)

    async def set(self, key: str, value, ex=None, nx: bool | None = None):
        if nx and key in self.store:
            return False
        self.store[key] = value
        return True

    async def rpush(self, key: str, *values):
        lst = self.store.setdefault(key, [])
        if not isinstance(lst, list):
            lst = []
        lst.extend(values)
        self.store[key] = lst
        return len(lst)

    async def ltrim(self, key: str, start: int, end: int):
        lst = self.store.get(key, [])
        if not isinstance(lst, list):
            return True
        if end == -1:
            end = len(lst) - 1
        self.store[key] = lst[start : end + 1]
        return True

    async def lrange(self, key: str, start: int, end: int):
        lst = self.store.get(key, [])
        if not isinstance(lst, list):
            return []
        if end == -1:
            end = len(lst) - 1
        return lst[start : end + 1]


class FakeRedisDecoded:
    def __init__(self):
        self.hash_store: dict[str, dict[str, object]] = {}

    async def hset(self, key: str, mapping: dict):
        bucket = self.hash_store.setdefault(key, {})
        for field, value in mapping.items():
            bucket[str(field)] = value
        return True

    async def hgetall(self, key: str):
        return self.hash_store.get(key, {}).copy()

    async def hget(self, key: str, field: str):
        bucket = self.hash_store.get(key, {})
        return bucket.get(str(field))


@pytest.mark.asyncio
async def test_get_health_status_returns_unknown_when_stale():
    redis = FakeRedis()
    svc = HealthMonitorService(redis, stale_seconds=5)
    await redis.hset(
        "provider:health:inst-1",
        mapping={
            "status": "healthy",
            "latency": 120,
            "last_check": int(time.time()) - 20,
        },
    )

    result = await svc.get_health_status("inst-1")

    assert result["status"] == "unknown"
    assert result["latency"] == 0
    assert result["last_check"] > 0


@pytest.mark.asyncio
async def test_record_heartbeat_throttle_and_status_change_bypass():
    redis = FakeRedis()
    svc = HealthMonitorService(redis, write_throttle_seconds=60)

    await svc.record_heartbeat("inst-2", 100, "healthy")
    await svc.record_heartbeat("inst-2", 110, "healthy")
    await svc.record_heartbeat("inst-2", 0, "down")

    history = await redis.lrange("provider:health:inst-2:history", 0, -1)
    status = await svc.get_health_status("inst-2")

    assert history == [100, 0]
    assert status["status"] == "down"
    assert status["latency"] == 0


@pytest.mark.asyncio
async def test_record_request_result_maps_status():
    redis = FakeRedis()
    svc = HealthMonitorService(redis, write_throttle_seconds=0)

    await svc.record_request_result(
        "inst-3", status_code=503, latency_ms=230, error_code=None
    )
    degraded = await svc.get_health_status("inst-3")
    assert degraded["status"] == "degraded"
    assert degraded["latency"] == 230

    await svc.record_request_result(
        "inst-3", status_code=401, latency_ms=140, error_code=None
    )
    healthy = await svc.get_health_status("inst-3")
    assert healthy["status"] == "healthy"
    assert healthy["latency"] == 140

    await svc.record_request_result(
        "inst-3", status_code=None, latency_ms=300, error_code="UPSTREAM_TIMEOUT"
    )
    down = await svc.get_health_status("inst-3")
    assert down["status"] == "down"
    assert down["latency"] == 0


@pytest.mark.asyncio
async def test_get_health_status_supports_decoded_response_keys():
    redis = FakeRedisDecoded()
    svc = HealthMonitorService(redis, stale_seconds=300)
    await redis.hset(
        "provider:health:inst-4",
        mapping={
            "status": "healthy",
            "latency": 321,
            "last_check": int(time.time()),
        },
    )

    result = await svc.get_health_status("inst-4")

    assert result["status"] == "healthy"
    assert result["latency"] == 321
    assert result["last_check"] > 0
