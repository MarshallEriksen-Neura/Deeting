from __future__ import annotations

import time
import uuid

from loguru import logger

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.tasks.async_runner import run_async
from app.services.memory.extractor import memory_extractor


@celery_app.task(name="memory.process_extraction", bind=True)
def process_memory_extraction(self, session_id: str, user_id: str | None) -> str:
    """
    延迟执行的记忆提取任务:
    - 检查活跃时间, 仍活跃则自动延期 (Reschedule)
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

            if not last_active_raw:
                await redis.delete(pending_key)
                return "no_last_active"

            last_active = float(last_active_raw)
            idle_time = time.time() - last_active
            window_seconds = 3 * 60

            # 仍在活跃窗口内 -> 自动延期
            if idle_time < window_seconds:
                remaining = window_seconds - idle_time
                retry_delay = max(5.0, remaining + 5.0)

                logger.info(
                    f"Session {session_id} active recently (idle {idle_time:.1f}s). Rescheduling in {retry_delay:.1f}s."
                )

                new_task = self.apply_async(
                    args=[session_id, user_id], countdown=retry_delay
                )
                await redis.set(pending_key, new_task.id, ex=int(retry_delay) + 60)
                return "rescheduled"

            # 满足闲置时间 -> 执行提取
            await redis.delete(pending_key)

            from app.services.conversation.service import get_conversation_service

            conv = get_conversation_service()
            window = await conv.load_window(session_id)
            messages = window.get("messages", []) if window else []
            if not messages:
                return "no_messages"

            if not user_id:
                return "no_user"

            # 从 Meta 中提取 secretary_id
            meta = window.get("meta", {})
            secretary_id_str = meta.get("secretary_id")
            secretary_id = (
                uuid.UUID(secretary_id_str)
                if secretary_id_str and isinstance(secretary_id_str, str)
                else None
            )

            async with AsyncSessionLocal() as db_session:
                await memory_extractor.extract_and_save(
                    uuid.UUID(user_id),
                    messages,
                    secretary_id=secretary_id,
                    db_session=db_session,
                )
            return "ok"

        except Exception as exc:  # pragma: no cover
            if "Event loop is closed" in str(exc):
                raise
            logger.error(f"memory extraction failed session={session_id} exc={exc}")
            try:
                if redis:
                    await redis.delete(pending_key)
            except Exception as cleanup_exc:
                logger.debug(
                    f"memory extraction cleanup failed session={session_id} exc={cleanup_exc}"
                )
            return "failed"

    try:
        return run_async(_async_process())
    except RuntimeError as exc:
        if "Event loop is closed" not in str(exc):
            raise

        logger.warning(
            f"memory extraction loop closed detected session={session_id}, reinitializing redis and retrying once"
        )
        try:
            cache.init()
        except Exception as init_exc:
            logger.warning(
                f"memory extraction redis reinit failed session={session_id} exc={init_exc}"
            )
            return "failed"

        try:
            return run_async(_async_process())
        except Exception as retry_exc:  # pragma: no cover
            logger.error(
                f"memory extraction retry failed session={session_id} exc={retry_exc}"
            )
            return "failed"
