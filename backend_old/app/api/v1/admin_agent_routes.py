from __future__ import annotations

import logging
from uuid import UUID
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

try:
    from redis.asyncio import Redis
except ModuleNotFoundError:  # pragma: no cover - dev env without redis
    Redis = object  # type: ignore[misc,assignment]

from app.deps import get_db, get_redis
from app.jwt_auth import AuthenticatedUser, require_superuser
from app.models.agent_task import AgentTaskStatus, AgentTaskType
from app.repositories import agent_task_repository
from app.schemas.agent_task import (
    AgentTaskListResponse,
    AgentTaskResponse,
)
from app.tasks.agent_tasks import (
    agent_crawl_task,
    agent_upload_task,
)

router = APIRouter(
    prefix="/v1/admin/agents",
    tags=["admin-agents"],
)
logger = logging.getLogger(__name__)


@router.get("/tasks", response_model=AgentTaskListResponse)
def list_tasks(
    status_filter: AgentTaskStatus | None = Query(None, alias="status", description="Filter by task status"),
    task_type: AgentTaskType | None = Query(
        None, alias="task_type", description="Filter by task type (use task_type)"
    ),
    legacy_task_type: AgentTaskType | None = Query(
        None, alias="type", description="Deprecated: use task_type instead"
    ),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    page: int | None = Query(None, ge=1, description="(Deprecated) Page number"),
    page_size: int | None = Query(None, ge=1, le=100, description="(Deprecated) Items per page"),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_superuser),
):
    """
    List agent tasks with optional filtering.

    支持新版 `limit/offset` 分页参数，也兼容旧的 `page/page_size`。
    """
    effective_limit = page_size if page_size is not None else limit
    effective_offset = offset
    if page is not None:
        effective_offset = (page - 1) * effective_limit

    effective_page = page if page is not None else (effective_offset // effective_limit) + 1
    selected_task_type = task_type or legacy_task_type

    tasks, total = agent_task_repository.list_tasks(
        db,
        status=status_filter,
        task_type=selected_task_type,
        limit=effective_limit,
        offset=effective_offset,
    )

    items = [AgentTaskResponse.model_validate(task) for task in tasks]

    return AgentTaskListResponse(
        items=items,
        total=total,
        page=effective_page,
        page_size=effective_limit,
    )


@router.get("/tasks/{task_id}", response_model=AgentTaskResponse)
def get_task(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_superuser),
):
    """
    Get detailed information about a specific agent task.
    """
    task = agent_task_repository.get_task(db, task_id=task_id)
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    return AgentTaskResponse.model_validate(task)


@router.post("/tasks/{task_id}/retry", response_model=AgentTaskResponse)
def retry_task(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_superuser),
):
    """
    Retry a failed or cancelled task.

    Only tasks in FAILED or CANCELLED status can be retried.
    """
    task = agent_task_repository.retry_task(db, task_id=task_id)
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task not found or cannot be retried (must be in FAILED or CANCELLED status)",
        )

    # Trigger Celery task based on task type
    celery_task = None
    if task.task_type == AgentTaskType.CRAWL.value:
        celery_task = agent_crawl_task.delay(str(task.id))
    elif task.task_type == AgentTaskType.UPLOAD.value:
        celery_task = agent_upload_task.delay(str(task.id))
    
    if celery_task:
        agent_task_repository.update_status(
            db, task_id=task.id, status=AgentTaskStatus.QUEUED, celery_task_id=celery_task.id
        )

    logger.info(f"Retrying task {task_id} by user {current_user.id}")
    db.refresh(task)
    return AgentTaskResponse.model_validate(task)


@router.get("/tasks/{task_id}/events")
async def stream_task_events(
    task_id: UUID,
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
    current_user: AuthenticatedUser = Depends(require_superuser),
):
    """
    SSE：推送任务进度/步骤。Redis 可用时用 pubsub，否则定期轮询 DB。
    """
    channel = f"agent_task_events:{task_id}"

    async def event_generator():
        pubsub = None
        use_redis = hasattr(redis, "pubsub")
        if use_redis:
            pubsub = redis.pubsub()
            await pubsub.subscribe(channel)
        try:
            while True:
                if use_redis:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if message and message.get("type") == "message":
                        payload = message["data"]
                        if isinstance(payload, (bytes, bytearray)):
                            payload = payload.decode("utf-8")
                        yield f"data: {payload}\n\n"
                        continue
                task = agent_task_repository.get_task(db, task_id=task_id)
                if task and task.steps is not None:
                    payload = {
                        "task_id": str(task_id),
                        "progress": task.progress,
                        "current_phase": task.current_phase,
                        "steps": task.steps,
                        "status": task.status,
                    }
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                await asyncio.sleep(2)
        finally:
            if use_redis and pubsub is not None:
                await pubsub.unsubscribe(channel)
                await pubsub.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")
