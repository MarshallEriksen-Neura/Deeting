"""
测试全局配置

- 默认禁用真实 Redis 连接，统一使用内存 DummyRedis，避免本地未启动 Redis 导致阻塞或退出不干净
- 该文件在 backend/tests 下的所有测试生效，无需额外设置 REDIS_URL
"""
from __future__ import annotations

import os
from typing import Any

from app.core.cache import cache
from app.core.config import settings

# 确保测试环境不读取外部 Redis
os.environ.setdefault("REDIS_URL", "")
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

    async def script_load(self, script: str):
        sha = f"sha:{len(self.scripts)+1}"
        self.scripts[sha] = script
        return sha

    async def evalsha(self, sha, keys=None, args=None):
        return None

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
