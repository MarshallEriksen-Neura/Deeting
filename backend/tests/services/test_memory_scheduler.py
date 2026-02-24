from types import SimpleNamespace

import pytest

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.services.memory.scheduler import MemoryScheduler


@pytest.mark.asyncio
async def test_memory_scheduler_reads_latest_redis_instance(monkeypatch):
    scheduled: list[tuple[list[str], int]] = []

    class _FakeRedis:
        def __init__(self) -> None:
            self._store: dict[str, str] = {}

        async def set(self, key: str, value, ex: int | None = None):
            self._store[key] = str(value)
            return True

        async def exists(self, key: str):
            return key in self._store

    def fake_apply_async(args, countdown):
        scheduled.append((args, countdown))
        return SimpleNamespace(id=f"memory-task-{len(scheduled)}")

    monkeypatch.setattr(
        "app.services.memory.scheduler.process_memory_extraction",
        SimpleNamespace(apply_async=fake_apply_async),
    )

    redis_first = _FakeRedis()
    redis_second = _FakeRedis()
    monkeypatch.setattr(cache, "_redis", redis_first)

    scheduler = MemoryScheduler(delay_seconds=5)
    await scheduler.touch_session("session-switch", "user-1")

    monkeypatch.setattr(cache, "_redis", redis_second)
    await scheduler.touch_session("session-switch-2", "user-2")

    pending_first = CacheKeys.memory_pending_task("session-switch")
    pending_second = CacheKeys.memory_pending_task("session-switch-2")

    assert redis_first._store[pending_first] == "memory-task-1"
    assert redis_second._store[pending_second] == "memory-task-2"
    assert len(scheduled) == 2


@pytest.mark.asyncio
async def test_memory_scheduler_skip_when_user_id_missing(monkeypatch):
    scheduled: list[tuple[list[str], int]] = []

    class _FakeRedis:
        def __init__(self) -> None:
            self._store: dict[str, str] = {}

        async def set(self, key: str, value, ex: int | None = None):
            self._store[key] = str(value)
            return True

        async def exists(self, key: str):
            return key in self._store

    def fake_apply_async(args, countdown):  # pragma: no cover
        scheduled.append((args, countdown))
        return SimpleNamespace(id=f"memory-task-{len(scheduled)}")

    monkeypatch.setattr(
        "app.services.memory.scheduler.process_memory_extraction",
        SimpleNamespace(apply_async=fake_apply_async),
    )
    redis = _FakeRedis()
    monkeypatch.setattr(cache, "_redis", redis)

    scheduler = MemoryScheduler(delay_seconds=5)
    await scheduler.touch_session("session-no-user", None)

    pending_key = CacheKeys.memory_pending_task("session-no-user")
    assert pending_key not in redis._store
    assert len(scheduled) == 0
