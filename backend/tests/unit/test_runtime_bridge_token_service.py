import asyncio
from datetime import timedelta

import pytest

from app.core import cache
from app.services.code_mode.runtime_bridge_token_service import (
    RuntimeBridgeClaims,
    RuntimeBridgeTokenService,
)
from app.utils.time_utils import Datetime


class _FakeRedis:
    def __init__(self):
        self._store: dict[str, dict] = {}

    async def hset(self, key, mapping):
        row = self._store.setdefault(key, {"hash": {}, "expires_at": None})
        for k, v in mapping.items():
            row["hash"][str(k)] = str(v)
        return 1

    async def expire(self, key, ttl):
        row = self._store.get(key)
        if not row:
            return 0
        row["expires_at"] = Datetime.now() + timedelta(seconds=int(ttl))
        return 1

    async def evalsha(self, sha, numkeys, key):
        row = self._store.get(key)
        if not row:
            return [0, "NOT_FOUND", 0, 0, "", -2]
        expires_at = row.get("expires_at")
        if expires_at and expires_at <= Datetime.now():
            self._store.pop(key, None)
            return [0, "NOT_FOUND", 0, 0, "", -2]

        claims_json = row["hash"].get("claims_json", "")
        used_calls = int(row["hash"].get("used_calls", "0"))
        max_calls = int(row["hash"].get("max_calls", "1"))
        ttl = (
            max(0, int((expires_at - Datetime.now()).total_seconds()))
            if expires_at
            else -1
        )
        if used_calls >= max_calls:
            return [0, "CALL_LIMIT", used_calls, max_calls, claims_json, ttl]
        row["hash"]["used_calls"] = str(used_calls + 1)
        return [1, "OK", used_calls, max_calls, claims_json, ttl]


@pytest.mark.asyncio
async def test_runtime_bridge_token_issue_and_consume_in_memory(monkeypatch):
    monkeypatch.setattr(cache, "_redis", None)
    service = RuntimeBridgeTokenService()
    claims = RuntimeBridgeClaims(
        user_id="123e4567-e89b-12d3-a456-426614174000",
        session_id="sess-001",
        max_calls=2,
    )

    issued = await service.issue_token(claims=claims, ttl_seconds=60)
    first = await service.consume_call(issued.token)
    second = await service.consume_call(issued.token)
    third = await service.consume_call(issued.token)

    assert first["ok"] is True
    assert first["call_index"] == 0
    assert second["ok"] is True
    assert second["call_index"] == 1
    assert third["ok"] is False
    assert third["error_code"] == "CODE_MODE_BRIDGE_CALL_LIMIT"


@pytest.mark.asyncio
async def test_runtime_bridge_token_missing(monkeypatch):
    monkeypatch.setattr(cache, "_redis", None)
    service = RuntimeBridgeTokenService()

    result = await service.consume_call("")

    assert result["ok"] is False
    assert result["error_code"] == "CODE_MODE_BRIDGE_MISSING_TOKEN"


@pytest.mark.asyncio
async def test_runtime_bridge_token_expired_in_memory(monkeypatch):
    monkeypatch.setattr(cache, "_redis", None)
    service = RuntimeBridgeTokenService()
    claims = RuntimeBridgeClaims(
        user_id="123e4567-e89b-12d3-a456-426614174000",
        session_id="sess-001",
    )
    issued = await service.issue_token(claims=claims, ttl_seconds=1)

    await asyncio.sleep(1.05)
    result = await service.consume_call(issued.token)

    assert result["ok"] is False
    assert result["error_code"] == "CODE_MODE_BRIDGE_TOKEN_EXPIRED"


@pytest.mark.asyncio
async def test_runtime_bridge_token_consume_redis_atomic(monkeypatch):
    service = RuntimeBridgeTokenService()
    fake_redis = _FakeRedis()
    monkeypatch.setattr(cache, "_redis", fake_redis)
    monkeypatch.setattr(cache, "get_script_sha", lambda name: "sha-code-mode" if name == "code_mode_bridge_consume" else None)

    async def _no_op_preload():
        return None

    monkeypatch.setattr(cache, "preload_scripts", _no_op_preload)

    claims = RuntimeBridgeClaims(
        user_id="123e4567-e89b-12d3-a456-426614174000",
        session_id="sess-redis",
        max_calls=2,
    )
    issued = await service.issue_token(claims=claims, ttl_seconds=60)

    first = await service.consume_call(issued.token)
    second = await service.consume_call(issued.token)
    third = await service.consume_call(issued.token)

    assert first["ok"] is True
    assert first["call_index"] == 0
    assert second["ok"] is True
    assert second["call_index"] == 1
    assert third["ok"] is False
    assert third["error_code"] == "CODE_MODE_BRIDGE_CALL_LIMIT"
