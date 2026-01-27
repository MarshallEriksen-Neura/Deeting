"""
测试全局配置

- 默认禁用真实 Redis 连接，统一使用内存 DummyRedis，避免本地未启动 Redis 导致阻塞或退出不干净
- 该文件在 backend/tests 下的所有测试生效，无需额外设置 REDIS_URL
"""
from __future__ import annotations

import asyncio
import json
import faulthandler
import os
import sys
import threading
from typing import Any

import pytest

from app.core.cache import cache
from app.core.config import settings

_HANG_DEBUG_ENV = "PYTEST_HANG_DEBUG"
_HANG_DEBUG_TIMEOUT = 30


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    try:
        api_conftest = sys.modules.get("tests.api.conftest")
        engine = getattr(api_conftest, "engine", None) if api_conftest else None
        if engine is not None:
            try:
                loop.run_until_complete(asyncio.wait_for(engine.dispose(), timeout=5))
            except Exception:
                pass
        cache_obj = getattr(api_conftest, "cache", None) if api_conftest else None
        if cache_obj is not None:
            try:
                loop.run_until_complete(asyncio.wait_for(cache_obj.close(), timeout=5))
            except Exception:
                pass
        try:
            loop.run_until_complete(asyncio.wait_for(loop.shutdown_asyncgens(), timeout=5))
        except Exception:
            pass
    finally:
        asyncio.set_event_loop(None)
        loop.close()


def pytest_sessionstart(session):  # type: ignore[unused-argument]
    if os.getenv(_HANG_DEBUG_ENV, "") == "1":
        faulthandler.dump_traceback_later(_HANG_DEBUG_TIMEOUT, repeat=True)


def pytest_sessionfinish(session, exitstatus):  # type: ignore[unused-argument]
    if os.getenv(_HANG_DEBUG_ENV, "") == "1":
        try:
            faulthandler.cancel_dump_traceback_later()
        except Exception:
            pass
        # 仅打印线程名，避免日志过重
        threads = ", ".join(t.name for t in threading.enumerate())
        print(f"[pytest-hang-debug] threads={threads}")

# 确保测试环境不读取外部 Redis/Celery
os.environ.setdefault("REDIS_URL", "")
os.environ.setdefault("CELERY_BROKER_URL", "")
os.environ.setdefault("CELERY_RESULT_BACKEND", "")
settings.REDIS_URL = ""


class DummyRedis:
    """
    轻量内存 Redis 替身，覆盖常用方法：
    - get/set/delete/keys/incr/exists/flushall
    - 提供与 tests/api 中 DummyRedis 相同的 store/hash_store/zset_store 属性，便于断言
    """

    def __init__(self):
        self.store: dict[str, Any] = {}
        self.hash_store: dict[str, dict[bytes, Any]] = {}
        self.zset_store: dict[str, list[tuple[str, float]]] = {}
        self.scripts: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value, ex=None, nx: bool | None = None):
        if nx and key in self.store:
            return False
        self.store[key] = value
        return True

    async def delete(self, *keys):
        removed = 0
        for k in keys:
            removed += 1 if self.store.pop(k, None) is not None else 0
            self.hash_store.pop(k, None)
            self.zset_store.pop(k, None)
        return removed

    async def unlink(self, *keys):
        return await self.delete(*keys)

    async def keys(self, pattern: str):
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            return [k for k in list(self.store) + list(self.hash_store) + list(self.zset_store) if k.startswith(prefix)]
        return [k for k in list(self.store) + list(self.hash_store) + list(self.zset_store) if k == pattern]

    async def exists(self, *keys):
        return sum(1 for k in keys if k in self.store or k in self.hash_store or k in self.zset_store)

    async def flushall(self):
        self.store.clear()
        self.hash_store.clear()
        self.zset_store.clear()
        self.scripts.clear()

    async def incr(self, key: str, amount: int = 1):
        current = self.store.get(key, 0)
        try:
            current_val = int(current)
        except Exception:
            current_val = 0
        new_val = current_val + amount
        self.store[key] = new_val
        return new_val

    async def expire(self, key: str, ttl):
        return True

    async def hset(self, key: str, mapping: dict):
        bucket = self.hash_store.setdefault(key, {})
        for k, v in mapping.items():
            bucket[k if isinstance(k, bytes) else str(k).encode()] = v
        return True

    async def rpush(self, key: str, *values):
        lst = self.store.setdefault(key, [])
        if not isinstance(lst, list):
            lst = []
        lst.extend(values)
        self.store[key] = lst
        return len(lst)

    async def lrange(self, key: str, start: int, end: int):
        lst = self.store.get(key, [])
        if not isinstance(lst, list):
            return []
        # emulate Redis end inclusive
        if end == -1:
            end = len(lst) - 1
        return lst[start : end + 1]

    async def ltrim(self, key: str, start: int, end: int):
        lst = self.store.get(key, [])
        if not isinstance(lst, list):
            return True
        if end == -1:
            end = len(lst) - 1
        self.store[key] = lst[start : end + 1]
        return True

    async def hgetall(self, key: str):
        return self.hash_store.get(key, {}).copy()

    async def hget(self, key: str, field: str):
        bucket = self.hash_store.get(key, {})
        return bucket.get(field if isinstance(field, bytes) else str(field).encode())

    async def script_load(self, script: str):
        sha = f"sha:{len(self.scripts)+1}"
        self.scripts[sha] = script
        return sha

    def register_script(self, script: str):
        async def _runner(*, keys=None, args=None, **_kwargs):
            keys = list(keys or [])
            args = list(args or [])
            if self._is_conversation_append_script(script):
                return await self._run_conversation_append_script(keys, args)
            return None

        return _runner

    @staticmethod
    def _is_conversation_append_script(script: str) -> bool:
        return "RPUSH" in script and "HINCRBY" in script and "LTRIM" in script

    async def _run_conversation_append_script(self, keys: list[str], args: list):
        if len(keys) < 2 or len(args) < 9:
            return None

        msgs_key, meta_key = keys[0], keys[1]

        def _decode_text(val):
            if isinstance(val, (bytes, bytearray)):
                return val.decode()
            if val is None:
                return ""
            return str(val)

        def _decode_int(val, default=0):
            try:
                if isinstance(val, (bytes, bytearray)):
                    val = val.decode()
                return int(float(val))
            except Exception:
                return default

        role = _decode_text(args[0])
        content = _decode_text(args[1])
        token_est = _decode_int(args[2], 0)
        is_truncated = _decode_int(args[3], 0)
        name_raw = _decode_text(args[4])
        meta_info_raw = args[5]
        max_turns = _decode_int(args[6], 0)
        max_turns_over = _decode_int(args[7], 0)
        flush_tokens = _decode_int(args[8], 0)

        bucket = self.hash_store.setdefault(meta_key, {})
        last_turn = _decode_int(bucket.get(b"last_turn"), 0) + 1
        total_tokens = _decode_int(bucket.get(b"total_tokens"), 0) + token_est
        bucket[b"last_turn"] = str(last_turn)
        bucket[b"total_tokens"] = str(total_tokens)

        meta_info = None
        if meta_info_raw not in (None, ""):
            raw_text = meta_info_raw
            if isinstance(raw_text, (bytes, bytearray)):
                raw_text = raw_text.decode()
            try:
                meta_info = json.loads(raw_text)
            except Exception:
                meta_info = raw_text

        msg = {
            "role": role,
            "content": content,
            "token_estimate": token_est,
            "is_truncated": bool(is_truncated),
            "name": name_raw or None,
            "meta_info": meta_info,
            "turn_index": last_turn,
        }
        msg_payload = json.dumps(msg, ensure_ascii=False).encode()

        lst = self.store.setdefault(msgs_key, [])
        if not isinstance(lst, list):
            lst = []
        lst.append(msg_payload)

        length = len(lst)
        if max_turns_over and length > max_turns_over:
            trim_start = max(length - max_turns, 0)
            lst = lst[trim_start:]
            self.store[msgs_key] = lst
            length = len(lst)

        should_flush = 1 if flush_tokens and total_tokens >= flush_tokens else 0
        return [total_tokens, length, should_flush, last_turn]

    async def evalsha(self, sha, *keys_and_args, keys=None, args=None):
        if keys is None and args is None:
            if not keys_and_args:
                return None
            numkeys = keys_and_args[0]
            if not isinstance(numkeys, int):
                return None
            keys = list(keys_and_args[1:1 + numkeys])
            args = list(keys_and_args[1 + numkeys:])
        if not keys or not args:
            return None
        key = keys[0]
        bucket = self.hash_store.get(key)
        if not bucket or len(args) < 6:
            return None
        # quota_deduct.lua 模拟
        def _get_num(field, default=0.0):
            raw = bucket.get(field if isinstance(field, bytes) else str(field).encode())
            if raw is None:
                return default
            if isinstance(raw, (bytes, bytearray)):
                raw = raw.decode()
            try:
                return float(raw)
            except Exception:
                return default

        def _get_str(field, default=""):
            raw = bucket.get(field if isinstance(field, bytes) else str(field).encode())
            if raw is None:
                return default
            if isinstance(raw, (bytes, bytearray)):
                return raw.decode()
            return str(raw)

        balance = _get_num("balance", 0.0)
        credit_limit = _get_num("credit_limit", 0.0)
        daily_quota = int(_get_num("daily_quota", 0))
        daily_used = int(_get_num("daily_used", 0))
        daily_date = _get_str("daily_date", "")
        monthly_quota = int(_get_num("monthly_quota", 0))
        monthly_used = int(_get_num("monthly_used", 0))
        monthly_month = _get_str("monthly_month", "")
        version = int(_get_num("version", 0))

        amount = float(args[0])
        daily_requests = int(args[1])
        monthly_requests = int(args[2])
        today = str(args[3])
        month = str(args[4])
        allow_negative = int(args[5])

        effective_balance = balance + credit_limit
        if allow_negative == 0 and effective_balance < amount:
            return [0, "INSUFFICIENT_BALANCE", balance, credit_limit, amount]

        if daily_date != today:
            daily_used = 0
            daily_date = today
        new_daily_used = daily_used + daily_requests
        if new_daily_used > daily_quota:
            return [0, "DAILY_QUOTA_EXCEEDED", daily_quota, daily_used]

        if monthly_month != month:
            monthly_used = 0
            monthly_month = month
        new_monthly_used = monthly_used + monthly_requests
        if new_monthly_used > monthly_quota:
            return [0, "MONTHLY_QUOTA_EXCEEDED", monthly_quota, monthly_used]

        new_balance = balance - amount
        bucket[b"balance"] = str(new_balance)
        bucket[b"daily_used"] = str(new_daily_used)
        bucket[b"daily_date"] = daily_date
        bucket[b"monthly_used"] = str(new_monthly_used)
        bucket[b"monthly_month"] = monthly_month
        bucket[b"version"] = str(version + 1)
        return [1, "OK", new_balance, new_daily_used, new_monthly_used, version + 1]

    async def eval(self, script, numkeys, *keys_and_args):
        keys = list(keys_and_args[:numkeys])
        args = list(keys_and_args[numkeys:])
        if "HGET" in script or "HSET" in script:
            if not keys or not args:
                return 0
            key = keys[0]
            bucket = self.hash_store.get(key)
            if not bucket:
                return 0
            balance_raw = bucket.get(b"balance")
            if balance_raw is None:
                return 0
            if isinstance(balance_raw, (bytes, bytearray)):
                try:
                    balance_val = float(balance_raw.decode())
                except Exception:
                    balance_val = 0.0
            else:
                try:
                    balance_val = float(balance_raw)
                except Exception:
                    balance_val = 0.0
            try:
                diff = float(args[0])
            except Exception:
                diff = 0.0
            new_balance = balance_val - diff
            bucket[b"balance"] = str(new_balance)
            version_raw = bucket.get(b"version")
            if version_raw is not None:
                if isinstance(version_raw, (bytes, bytearray)):
                    try:
                        version_val = int(float(version_raw.decode()))
                    except Exception:
                        version_val = 0
                else:
                    try:
                        version_val = int(float(version_raw))
                    except Exception:
                        version_val = 0
                bucket[b"version"] = str(version_val + 1)
            return 1

        if not keys:
            return 0
        key = keys[0]
        if "expire" in script:
            if len(args) < 2:
                return 0
            lock_val = str(args[0])
            stored = self.store.get(key)
            if stored is None:
                return 0
            stored_val = stored.decode() if isinstance(stored, (bytes, bytearray)) else str(stored)
            if stored_val != lock_val:
                return 0
            return 1

        if not args:
            return 0
        lock_val = str(args[0])
        stored = self.store.get(key)
        if stored is None:
            return 0
        stored_val = stored.decode() if isinstance(stored, (bytes, bytearray)) else str(stored)
        if stored_val != lock_val:
            return 0
        await self.delete(key)
        return 1

    async def zadd(self, key: str, mapping: dict[str, float]):
        items = self.zset_store.setdefault(key, [])
        filtered = [(m, s) for (m, s) in items if m not in mapping]
        for member, score in mapping.items():
            filtered.append((member, float(score)))
        self.zset_store[key] = filtered
        return True


# 仅在未被其他 conftest 覆盖时注入 DummyRedis
if getattr(cache, "_redis", None) is None:
    cache._redis = DummyRedis()  # type: ignore[attr-defined]
