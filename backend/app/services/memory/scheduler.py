from __future__ import annotations

import time
from typing import Optional

from loguru import logger

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.tasks.memory_tasks import process_memory_extraction


class MemoryScheduler:
    """
    负责“沉默触发”记忆提取的防抖调度：
    - 每次有新消息调用 touch_session，刷新活跃时间并投递延迟任务
    - Worker 执行时二次校验 last_active，若仍在活跃窗口内则跳过
    """

    def __init__(self, delay_seconds: Optional[int] = None):
        self.redis = cache._redis  # 复用现有 redis 连接
        if not self.redis:
            raise RuntimeError("Redis 未初始化，无法使用 MemoryScheduler")
        self.delay_seconds = delay_seconds or 15 * 60  # 默认 15 分钟

    async def touch_session(self, session_id: str, user_id: Optional[str] = None) -> None:
        """
        防抖入口：每条消息后调用。轻量，不抛异常。
        """
        try:
            now = time.time()
            last_active_key = CacheKeys.memory_last_active(session_id)
            pending_key = CacheKeys.memory_pending_task(session_id)

            # 记录最后活跃时间
            await self.redis.set(last_active_key, now, ex=settings.CONVERSATION_REDIS_TTL_SECONDS)

            # 若已有 pending 任务，直接返回，由任务自己检查 last_active
            if await self.redis.exists(pending_key):
                return

            # 投递延迟任务，执行时二次校验
            task = process_memory_extraction.apply_async(
                args=[session_id, user_id],
                countdown=self.delay_seconds,
            )
            await self.redis.set(pending_key, task.id, ex=self.delay_seconds)
        except Exception as exc:  # pragma: no cover - 防御
            logger.warning(f"memory scheduler touch failed session={session_id}: {exc}")


memory_scheduler = MemoryScheduler()


__all__ = ["MemoryScheduler", "memory_scheduler"]
