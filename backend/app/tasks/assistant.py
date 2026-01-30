from __future__ import annotations

from app.core.celery_app import celery_app


@celery_app.task(name="assistant.sync_to_qdrant")
def sync_assistant_to_qdrant(assistant_id: str) -> str:
    return "not_implemented"
