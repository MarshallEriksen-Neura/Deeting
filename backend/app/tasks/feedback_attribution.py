from __future__ import annotations

import asyncio

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.services.feedback.trace_feedback_service import FeedbackAttributionService


@celery_app.task(name="app.tasks.feedback.process_trace_feedback", bind=True)
def process_trace_feedback(self, feedback_id: str) -> str:
    async def _run() -> None:
        async with AsyncSessionLocal() as session:
            service = FeedbackAttributionService(session)
            await service.process_feedback(feedback_id)

    try:
        asyncio.run(_run())
        return f"processed:{feedback_id}"
    except Exception as exc:  # pragma: no cover - 交给 Celery 重试策略
        logger.error("trace_feedback_process_failed id=%s err=%s", feedback_id, exc)
        raise


__all__ = ["process_trace_feedback"]
