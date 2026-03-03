from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.api.v1.monitor_route import _check_manual_trigger_cooldown
from app.core.cache import cache
from app.core.config import settings


@pytest.mark.asyncio
async def test_manual_trigger_cooldown_allows_first_request(monkeypatch: pytest.MonkeyPatch):
    async def _cache_set(*args, **kwargs):
        return True

    monkeypatch.setattr(settings, "MONITOR_MANUAL_TRIGGER_COOLDOWN_SECONDS", 30, raising=False)
    monkeypatch.setattr(cache, "set", _cache_set)

    await _check_manual_trigger_cooldown(uuid.uuid4(), uuid.uuid4())


@pytest.mark.asyncio
async def test_manual_trigger_cooldown_blocks_repeated_request(monkeypatch: pytest.MonkeyPatch):
    async def _cache_set(*args, **kwargs):
        return False

    monkeypatch.setattr(settings, "MONITOR_MANUAL_TRIGGER_COOLDOWN_SECONDS", 30, raising=False)
    monkeypatch.setattr(cache, "set", _cache_set)
    monkeypatch.setattr(cache, "_redis", object())

    with pytest.raises(HTTPException) as exc_info:
        await _check_manual_trigger_cooldown(uuid.uuid4(), uuid.uuid4())
    assert exc_info.value.status_code == 429
    assert "触发过于频繁" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_manual_trigger_cooldown_skips_block_when_redis_unavailable(
    monkeypatch: pytest.MonkeyPatch,
):
    async def _cache_set(*args, **kwargs):
        return False

    monkeypatch.setattr(settings, "MONITOR_MANUAL_TRIGGER_COOLDOWN_SECONDS", 30, raising=False)
    monkeypatch.setattr(cache, "set", _cache_set)
    monkeypatch.setattr(cache, "_redis", None)

    await _check_manual_trigger_cooldown(uuid.uuid4(), uuid.uuid4())
