import json
import time
from types import SimpleNamespace

import pytest

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.services.conversation.summary_scheduler import SummaryScheduler
from app.tasks.conversation import _run_summary_idle_check
from app.utils.time_utils import Datetime


@pytest.mark.asyncio
async def test_summary_scheduler_touch_session_idempotent(monkeypatch):
    scheduled: list[tuple[list[str], int]] = []

    def fake_apply_async(args, countdown):
        scheduled.append((args, countdown))
        return SimpleNamespace(id="task-1")

    monkeypatch.setattr(
        "app.services.conversation.summary_scheduler.conversation_summary_idle_check",
        SimpleNamespace(apply_async=fake_apply_async),
    )

    scheduler = SummaryScheduler(delay_seconds=5)
    session_id = "session-touch"
    await scheduler.touch_session(session_id)

    last_active_key = CacheKeys.conversation_summary_last_active(session_id)
    pending_key = CacheKeys.conversation_summary_pending_task(session_id)
    assert await cache._redis.get(last_active_key) is not None
    assert await cache._redis.get(pending_key) == "task-1"

    await scheduler.touch_session(session_id)
    assert len(scheduled) == 1


@pytest.mark.asyncio
async def test_run_summary_idle_check_skips_when_active():
    session_id = "session-active"
    last_active_key = CacheKeys.conversation_summary_last_active(session_id)
    pending_key = CacheKeys.conversation_summary_pending_task(session_id)
    meta_key = CacheKeys.conversation_meta(session_id)

    await cache._redis.set(last_active_key, time.time())
    await cache._redis.set(pending_key, "task-1")
    await cache._redis.hset(meta_key, mapping={"last_turn": 2, "summarizing": 0})

    result = await _run_summary_idle_check(session_id)
    assert result == "skip_active"
    assert await cache._redis.get(pending_key) is None


@pytest.mark.asyncio
async def test_run_summary_idle_check_queues_when_idle(monkeypatch):
    session_id = "session-idle"
    last_active_key = CacheKeys.conversation_summary_last_active(session_id)
    pending_key = CacheKeys.conversation_summary_pending_task(session_id)
    meta_key = CacheKeys.conversation_meta(session_id)
    summary_key = CacheKeys.conversation_summary(session_id)

    await cache._redis.set(
        last_active_key,
        time.time() - settings.CONVERSATION_SUMMARY_IDLE_SECONDS - 5,
    )
    await cache._redis.set(pending_key, "task-1")
    await cache._redis.hset(meta_key, mapping={"last_turn": 3, "summarizing": 0})
    await cache._redis.set(
        summary_key,
        json.dumps(
            {
                "covered_to_turn": 1,
                "generated_at": Datetime.from_timestamp(0).isoformat(),
            }
        ),
    )

    def fake_delay(session_id: str):
        return SimpleNamespace(id="job-1")

    monkeypatch.setattr(
        "app.tasks.conversation.conversation_summarize",
        SimpleNamespace(delay=fake_delay),
    )

    result = await _run_summary_idle_check(session_id)
    assert result == "queued"

    meta = await cache._redis.hgetall(meta_key)
    assert meta.get(b"summarizing") in (1, "1", b"1")
    assert meta.get(b"summary_job_id") in ("job-1", b"job-1")
    assert await cache._redis.get(pending_key) is None


@pytest.mark.asyncio
async def test_run_summary_idle_check_skips_without_new_messages():
    session_id = "session-no-new"
    last_active_key = CacheKeys.conversation_summary_last_active(session_id)
    meta_key = CacheKeys.conversation_meta(session_id)
    summary_key = CacheKeys.conversation_summary(session_id)

    await cache._redis.set(
        last_active_key,
        time.time() - settings.CONVERSATION_SUMMARY_IDLE_SECONDS - 5,
    )
    await cache._redis.hset(meta_key, mapping={"last_turn": 2, "summarizing": 0})
    await cache._redis.set(
        summary_key,
        json.dumps(
            {
                "covered_to_turn": 2,
                "generated_at": Datetime.from_timestamp(0).isoformat(),
            }
        ),
    )

    result = await _run_summary_idle_check(session_id)
    assert result == "no_new_messages"


@pytest.mark.asyncio
async def test_run_summary_idle_check_respects_min_interval(monkeypatch):
    session_id = "session-min-interval"
    last_active_key = CacheKeys.conversation_summary_last_active(session_id)
    meta_key = CacheKeys.conversation_meta(session_id)
    summary_key = CacheKeys.conversation_summary(session_id)

    await cache._redis.set(
        last_active_key,
        time.time() - settings.CONVERSATION_SUMMARY_IDLE_SECONDS - 5,
    )
    await cache._redis.hset(meta_key, mapping={"last_turn": 3, "summarizing": 0})
    await cache._redis.set(
        summary_key,
        json.dumps(
            {
                "covered_to_turn": 1,
                "generated_at": Datetime.now().isoformat(),
            }
        ),
    )

    monkeypatch.setattr(settings, "CONVERSATION_SUMMARY_MIN_INTERVAL_SECONDS", 600)
    result = await _run_summary_idle_check(session_id)
    assert result == "min_interval"
