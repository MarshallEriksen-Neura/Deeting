from __future__ import annotations

import uuid
from typing import Any

from app.core.database import AsyncSessionLocal
from app.models.notification import NotificationLevel, NotificationType
from app.services.notifications.notification_service import NotificationService


async def push_task_progress(
    user_id: uuid.UUID | str | None,
    task_id: str,
    step: str,
    message: str,
    status: str = "processing",
    percentage: int | None = None,
    payload: dict[str, Any] | None = None,
):
    """
    Sends a structured task progress notification via WebSocket.
    This is used by the frontend to render 'Live UI Blocks' in the chat气泡.
    """
    if not user_id:
        return

    async with AsyncSessionLocal() as session:
        service = NotificationService(session)

        # Structure the payload specifically for the 'TaskLiveBlock' UI
        full_payload = {
            "task_id": task_id,
            "step": step,
            "status": status,  # processing, completed, failed
            "percentage": percentage,
            "message": message,
            "is_live_block": True,  # Hint for frontend to render specialized UI
        }
        if payload:
            full_payload.update(payload)

        await service.publish_to_user(
            user_id=user_id,
            title=f"Task Progress: {step}",
            content=message,
            notification_type=NotificationType.SYSTEM,
            level=NotificationLevel.INFO,
            payload=full_payload,
            source="task_worker",
            enqueue=True,  # Send via Celery to avoid blocking worker
            commit=True,
        )
