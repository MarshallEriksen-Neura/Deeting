from __future__ import annotations

from datetime import timedelta

import pytest

from app.tasks import monitor as monitor_tasks
from app.utils.time_utils import Datetime


class FakeRedis:
    def __init__(self) -> None:
        self._zsets: dict[str, dict[str, float]] = {}

    async def zadd(self, key: str, mapping: dict[str, float]) -> int:
        zset = self._zsets.setdefault(key, {})
        for member, score in mapping.items():
            zset[str(member)] = float(score)
        return len(mapping)

    async def zrangebyscore(self, key: str, min: str, max: float, start: int, num: int):
        zset = self._zsets.get(key, {})
        items = sorted(zset.items(), key=lambda item: item[1])
        due = [m.encode("utf-8") for m, s in items if s <= float(max)]
        return due[start : start + num]

    async def zrem(self, key: str, *members: str) -> int:
        zset = self._zsets.get(key, {})
        removed = 0
        for m in members:
            member = m.decode("utf-8") if isinstance(m, bytes) else str(m)
            if member in zset:
                del zset[member]
                removed += 1
        return removed


@pytest.mark.asyncio
async def test_zset_pop_due_task_ids_removes_due_members(monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr(monitor_tasks, "_get_redis_client", lambda: fake_redis)

    now = Datetime.now()
    due_at = now - timedelta(minutes=1)
    future_at = now + timedelta(minutes=1)

    await monitor_tasks._zset_add_task("task_due", due_at)
    await monitor_tasks._zset_add_task("task_future", future_at)

    popped = await monitor_tasks._zset_pop_due_task_ids(now.timestamp(), limit=10)
    assert popped == ["task_due"]

    popped_again = await monitor_tasks._zset_pop_due_task_ids(now.timestamp(), limit=10)
    assert popped_again == []


def test_redis_schedule_key_has_cache_prefix():
    key = monitor_tasks._redis_schedule_key()
    assert key.endswith("monitor:schedule:zset")
