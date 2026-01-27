"""
分布式锁实现（基于 Redis）

提供基于 Redis 的分布式锁，用于会话并发控制等场景。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from app.core.cache import cache

logger = logging.getLogger(__name__)


class LockAcquisitionError(Exception):
    """锁获取失败异常"""

    pass


class DistributedLock:
    """分布式锁（基于 Redis SET NX EX）"""

    def __init__(
        self,
        key: str,
        ttl: int = 30,
        retry_times: int = 3,
        retry_delay: float = 0.1,
    ):
        """
        Args:
            key: 锁的 Redis Key
            ttl: 锁的过期时间（秒）
            retry_times: 获取锁失败时的重试次数
            retry_delay: 重试间隔（秒）
        """
        self.key = key
        self.ttl = ttl
        self.retry_times = retry_times
        self.retry_delay = retry_delay
        self.lock_value = str(uuid.uuid4())
        self._acquired = False

    async def acquire(self) -> bool:
        """
        获取锁

        Returns:
            True: 获取成功
            False: 获取失败
        """
        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            logger.warning("distributed_lock_redis_unavailable key=%s", self.key)
            return True  # Redis 不可用时降级放行

        for attempt in range(self.retry_times):
            try:
                full_key = cache._make_key(self.key)
                acquired = await redis_client.set(
                    full_key,
                    self.lock_value,
                    ex=self.ttl,
                    nx=True,
                )
                if acquired:
                    self._acquired = True
                    logger.debug("distributed_lock_acquired key=%s value=%s", self.key, self.lock_value)
                    return True

                if attempt < self.retry_times - 1:
                    await asyncio.sleep(self.retry_delay)
            except Exception as exc:
                logger.warning("distributed_lock_acquire_error key=%s attempt=%d err=%s", self.key, attempt, exc)
                if attempt < self.retry_times - 1:
                    await asyncio.sleep(self.retry_delay)

        logger.warning("distributed_lock_acquire_failed key=%s", self.key)
        return False

    async def release(self) -> bool:
        """
        释放锁（使用 Lua 脚本确保只释放自己持有的锁）

        Returns:
            True: 释放成功
            False: 释放失败（锁不存在或已被其他持有者占用）
        """
        if not self._acquired:
            return True

        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            return True

        try:
            # Lua 脚本：只有当锁的值匹配时才删除
            lua_script = """
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
            """
            full_key = cache._make_key(self.key)
            result = await redis_client.eval(lua_script, 1, full_key, self.lock_value)
            released = bool(result)
            if released:
                logger.debug("distributed_lock_released key=%s value=%s", self.key, self.lock_value)
            else:
                logger.warning("distributed_lock_release_failed key=%s value=%s", self.key, self.lock_value)
            self._acquired = False
            return released
        except Exception as exc:
            logger.error("distributed_lock_release_error key=%s err=%s", self.key, exc)
            return False

    async def extend(self, additional_ttl: int | None = None) -> bool:
        """
        延长锁的过期时间

        Args:
            additional_ttl: 额外的过期时间（秒），默认使用初始 ttl

        Returns:
            True: 延长成功
            False: 延长失败
        """
        if not self._acquired:
            return False

        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            return True

        try:
            ttl = additional_ttl or self.ttl
            # Lua 脚本：只有当锁的值匹配时才延长过期时间
            lua_script = """
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("expire", KEYS[1], ARGV[2])
            else
                return 0
            end
            """
            full_key = cache._make_key(self.key)
            result = await redis_client.eval(lua_script, 1, full_key, self.lock_value, ttl)
            extended = bool(result)
            if extended:
                logger.debug("distributed_lock_extended key=%s ttl=%d", self.key, ttl)
            else:
                logger.warning("distributed_lock_extend_failed key=%s", self.key)
            return extended
        except Exception as exc:
            logger.error("distributed_lock_extend_error key=%s err=%s", self.key, exc)
            return False

    @asynccontextmanager
    async def __call__(self) -> AsyncGenerator[bool, None]:
        """
        上下文管理器用法

        async with DistributedLock(key)() as acquired:
            if acquired:
                # 持有锁，执行临界区代码
                pass
            else:
                # 未获取到锁
                pass
        """
        acquired = await self.acquire()
        try:
            yield acquired
        finally:
            if acquired:
                await self.release()


@asynccontextmanager
async def distributed_lock(
    key: str,
    ttl: int = 30,
    retry_times: int = 50,
    retry_delay: float = 0.1,
    raise_on_failure: bool = False,
) -> AsyncGenerator[bool, None]:
    """
    分布式锁的便捷上下文管理器

    Args:
        key: 锁的 Redis Key
        ttl: 锁的过期时间（秒）
        retry_times: 获取锁失败时的重试次数
        retry_delay: 重试间隔（秒）
        raise_on_failure: 获取锁失败时是否抛出异常

    Yields:
        True: 获取锁成功
        False: 获取锁失败

    Raises:
        LockAcquisitionError: 当 raise_on_failure=True 且获取锁失败时

    Example:
        async with distributed_lock("my_lock", ttl=10) as acquired:
            if acquired:
                # 持有锁，执行临界区代码
                pass
            else:
                # 未获取到锁，执行降级逻辑
                pass
    """
    lock = DistributedLock(key, ttl, retry_times, retry_delay)
    acquired = await lock.acquire()

    if not acquired and raise_on_failure:
        raise LockAcquisitionError(f"Failed to acquire lock: {key}")

    try:
        yield acquired
    finally:
        if acquired:
            await lock.release()
