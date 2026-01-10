from __future__ import annotations

import asyncio
import time
import uuid

from loguru import logger

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.celery_app import celery_app
from app.services.memory.extractor import memory_extractor


@celery_app.task(name="memory.process_extraction")
def process_memory_extraction(session_id: str, user_id: str | None) -> str:
    """
    延迟执行的记忆提取任务：
    - 检查活跃时间，仍活跃则跳过
    - 否则读取窗口并提取记忆入库
    """
    redis = getattr(cache, "_redis", None)
    if not redis:
        logger.warning("memory extraction skipped: redis unavailable")
        return "redis_unavailable"

    last_active_key = CacheKeys.memory_last_active(session_id)
    pending_key = CacheKeys.memory_pending_task(session_id)

    try:
        last_active_raw = redis.get(last_active_key)
        redis.delete(pending_key)
        if not last_active_raw:
            return "no_last_active"

        last_active = float(last_active_raw)
        # 仍在活跃窗口内则跳过
        if time.time() - last_active < 15 * 60:
            return "skip_active"

        from app.services.conversation.service import get_conversation_service

        conv = get_conversation_service()
        window = asyncio.run(conv.load_window(session_id))  # 复用已有异步实现
        messages = window.get("messages", []) if window else []
        if not messages:
            return "no_messages"

        if not user_id:
            return "no_user"
        asyncio.run(memory_extractor.extract_and_save(uuid.UUID(user_id), messages))
        return "ok"
    except Exception as exc:  # pragma: no cover
        logger.error(f"memory extraction failed session={session_id} exc={exc}")
        return "failed"
