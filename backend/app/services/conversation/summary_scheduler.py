from __future__ import annotations

import time
from typing import Optional

from loguru import logger

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.tasks.conversation import conversation_summary_idle_check


class SummaryScheduler:
    """
    会话摘要的“沉默触发”调度器：
    - 每次有新消息调用 touch_session，刷新活跃时间并投递延迟任务
    - 任务执行时二次校验是否仍在活跃窗口
    """

    def __init__(self, delay_seconds: Optional[int] = None):
        self.redis = cache._redis
        if not self.redis:
            raise RuntimeError("Redis 未初始化，无法使用 SummaryScheduler")
        self.delay_seconds = delay_seconds or settings.CONVERSATION_SUMMARY_IDLE_SECONDS

    async def touch_session(self, session_id: str) -> None:
        try:
            now = time.time()
            last_active_key = CacheKeys.conversation_summary_last_active(session_id)
            pending_key = CacheKeys.conversation_summary_pending_task(session_id)

            # 记录最后活跃时间
            await self.redis.set(
                last_active_key,
                now,
                ex=settings.CONVERSATION_REDIS_TTL_SECONDS,
            )

            # 已有 pending 任务则不重复投递
            if await self.redis.exists(pending_key):
                return

            task = conversation_summary_idle_check.apply_async(
                args=[session_id],
                countdown=self.delay_seconds,
            )
            await self.redis.set(pending_key, task.id, ex=self.delay_seconds)
        except Exception as exc:  # pragma: no cover - 防御
            logger.warning(f"summary scheduler touch failed session={session_id}: {exc}")


summary_scheduler = SummaryScheduler()


__all__ = ["SummaryScheduler", "summary_scheduler"]
