from __future__ import annotations

import asyncio

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.services.image_generation.service import ImageGenerationService


@celery_app.task(
    name="app.tasks.image_generation.process_task",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    max_retries=3,
)
def process_image_generation_task(self, task_id: str) -> str:
    async def _run() -> None:
        async with AsyncSessionLocal() as session:
            service = ImageGenerationService(session)
            await service.process_task(task_id)

    try:
        asyncio.run(_run())
        return f"processed:{task_id}"
    except Exception as exc:  # pragma: no cover - 由 Celery 重试
        logger.error("image_generation_task_failed task_id=%s err=%s", task_id, exc)
        raise


__all__ = ["process_image_generation_task"]
