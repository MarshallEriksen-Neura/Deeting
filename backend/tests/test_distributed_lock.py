"""
分布式锁测试

测试 DistributedLock 的基本功能：
- 锁的获取和释放
- 锁的过期
- 锁的竞争
"""

import asyncio

import pytest

from app.core.distributed_lock import DistributedLock, distributed_lock


@pytest.mark.asyncio
async def test_distributed_lock_acquire_release():
    """测试锁的获取和释放"""
    lock = DistributedLock("test_lock_1", ttl=5)
    
    # 获取锁
    acquired = await lock.acquire()
    assert acquired is True
    
    # 释放锁
    released = await lock.release()
    assert released is True


@pytest.mark.asyncio
async def test_distributed_lock_competition():
    """测试锁的竞争"""
    lock1 = DistributedLock("test_lock_2", ttl=5)
    lock2 = DistributedLock("test_lock_2", ttl=5)
    
    # 第一个锁获取成功
    acquired1 = await lock1.acquire()
    assert acquired1 is True
    
    # 第二个锁获取失败（同一个 key）
    acquired2 = await lock2.acquire()
    assert acquired2 is False
    
    # 释放第一个锁
    await lock1.release()
    
    # 第二个锁现在可以获取
    acquired2 = await lock2.acquire()
    assert acquired2 is True
    
    await lock2.release()


@pytest.mark.asyncio
async def test_distributed_lock_context_manager():
    """测试上下文管理器用法"""
    async with distributed_lock("test_lock_3", ttl=5) as acquired:
        assert acquired is True
    
    # 锁已释放，可以再次获取
    async with distributed_lock("test_lock_3", ttl=5) as acquired:
        assert acquired is True


@pytest.mark.asyncio
async def test_distributed_lock_extend():
    """测试锁的延长"""
    lock = DistributedLock("test_lock_4", ttl=2)
    
    acquired = await lock.acquire()
    assert acquired is True
    
    # 延长锁
    extended = await lock.extend(additional_ttl=5)
    assert extended is True
    
    await lock.release()


@pytest.mark.asyncio
async def test_distributed_lock_concurrent_access():
    """测试并发访问"""
    counter = {"value": 0}
    
    async def increment_with_lock():
        async with distributed_lock("test_lock_5", ttl=5) as acquired:
            if acquired:
                # 模拟临界区操作
                current = counter["value"]
                await asyncio.sleep(0.01)  # 模拟耗时操作
                counter["value"] = current + 1
    
    # 并发执行 10 次
    tasks = [increment_with_lock() for _ in range(10)]
    await asyncio.gather(*tasks)
    
    # 由于锁保护，计数器应该正确递增
    assert counter["value"] == 10
