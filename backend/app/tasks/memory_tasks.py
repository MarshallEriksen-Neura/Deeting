from __future__ import annotations

import asyncio
import time
import uuid

from loguru import logger

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.celery_app import celery_app
from app.services.memory.extractor import memory_extractor


@celery_app.task(name="memory.process_extraction", bind=True)
def process_memory_extraction(self, session_id: str, user_id: str | None) -> str:
    """
    延迟执行的记忆提取任务：
    - 检查活跃时间，仍活跃则自动延期（Reschedule）
    - 否则读取窗口并提取记忆入库
    """
    
    async def _async_process() -> str:
        redis = getattr(cache, "_redis", None)
        if not redis:
            logger.warning("memory extraction skipped: redis unavailable")
            return "redis_unavailable"

        last_active_key = CacheKeys.memory_last_active(session_id)
        pending_key = CacheKeys.memory_pending_task(session_id)

        try:
            last_active_raw = await redis.get(last_active_key)
            # 先不急着删除 pending_key，决定是否执行后再处理
            
            if not last_active_raw:
                # 异常情况：没有活跃记录，清理锁并退出
                await redis.delete(pending_key)
                return "no_last_active"

            last_active = float(last_active_raw)
            idle_time = time.time() - last_active
            window_seconds = 15 * 60

            # 仍在活跃窗口内 -> 自动延期
            if idle_time < window_seconds:
                remaining = window_seconds - idle_time
                retry_delay = max(5.0, remaining + 5.0) # 至少等 5 秒，多给 5 秒缓冲
                
                logger.info(f"Session {session_id} active recently (idle {idle_time:.1f}s). Rescheduling in {retry_delay:.1f}s.")
                
                # 重新投递任务
                new_task = self.apply_async(
                    args=[session_id, user_id],
                    countdown=retry_delay
                )
                
                # 更新 pending_key 指向新任务 (防止 MemoryScheduler 投递重复任务)
                await redis.set(pending_key, new_task.id, ex=int(retry_delay) + 60)
                return "rescheduled"

            # 满足闲置时间 -> 执行提取
            # 删除锁，允许后续新消息再次触发调度
            await redis.delete(pending_key)

            from app.services.conversation.service import get_conversation_service

            conv = get_conversation_service()
            window = await conv.load_window(session_id)
            messages = window.get("messages", []) if window else []
            if not messages:
                return "no_messages"

            if not user_id:
                return "no_user"
            
            await memory_extractor.extract_and_save(uuid.UUID(user_id), messages)
            return "ok"
            
        except Exception as exc:  # pragma: no cover
            logger.error(f"memory extraction failed session={session_id} exc={exc}")
            # 异常时清理锁，避免死锁
            try:
                if redis: await redis.delete(pending_key)
            except: pass
            return "failed"

    return asyncio.run(_async_process())
