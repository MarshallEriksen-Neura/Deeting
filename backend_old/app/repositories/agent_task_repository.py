from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Select, select, func
from sqlalchemy.orm import Session

from app.models.agent_task import AgentTask, AgentTaskStatus, AgentTaskType


def create_task(
    db: Session,
    *,
    task_type: AgentTaskType,
    target_url: str | None = None,
    target_file_path: str | None = None,
    provider_slug: str | None = None,
    depth: int = 1,
    max_pages: int = 10,
    tags: list[str] | None = None,
    config: dict[str, Any] | None = None,
    created_by_id: UUID | None = None,
    steps: list[dict[str, Any]] | None = None,
    progress: int | None = None,
    current_phase: str | None = None,
    scratchpad: dict[str, Any] | None = None,
) -> AgentTask:
    """Create a new agent task."""
    task = AgentTask(
        task_type=task_type.value,
        status=AgentTaskStatus.PENDING.value,
        target_url=target_url,
        target_file_path=target_file_path,
        provider_slug=provider_slug,
        depth=depth,
        max_pages=max_pages,
        tags=tags,
        config=config,
        created_by_id=created_by_id,
        steps=steps,
        progress=progress,
        current_phase=current_phase,
        scratchpad=scratchpad,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def get_task(db: Session, *, task_id: UUID) -> AgentTask | None:
    """Get a task by ID."""
    stmt: Select[tuple[AgentTask]] = select(AgentTask).where(AgentTask.id == task_id)
    return db.execute(stmt).scalars().first()


def list_tasks(
    db: Session,
    *,
    status: AgentTaskStatus | None = None,
    task_type: AgentTaskType | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[AgentTask], int]:
    """List tasks with optional filtering and pagination."""
    stmt: Select[tuple[AgentTask]] = select(AgentTask)

    if status is not None:
        stmt = stmt.where(AgentTask.status == status.value)
    if task_type is not None:
        stmt = stmt.where(AgentTask.task_type == task_type.value)

    # Get total count
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.execute(count_stmt).scalar() or 0

    # Apply pagination
    stmt = stmt.order_by(AgentTask.created_at.desc()).limit(limit).offset(offset)
    tasks = list(db.execute(stmt).scalars().all())

    return tasks, total


def update_status(
    db: Session,
    *,
    task_id: UUID,
    status: AgentTaskStatus,
    celery_task_id: str | None = None,
    worker_node: str | None = None,
    result_summary: dict[str, Any] | None = None,
    error_message: str | None = None,
    steps: list[dict[str, Any]] | None = None,
    progress: int | None = None,
    current_phase: str | None = None,
    scratchpad: dict[str, Any] | None = None,
) -> AgentTask | None:
    """Update task status and related fields."""
    task = get_task(db, task_id=task_id)
    if task is None:
        return None

    task.status = status.value
    if celery_task_id is not None:
        task.celery_task_id = celery_task_id
    if worker_node is not None:
        task.worker_node = worker_node
    if result_summary is not None:
        task.result_summary = result_summary
    if error_message is not None:
        task.error_message = error_message
    if steps is not None:
        task.steps = steps
    if progress is not None:
        task.progress = progress
    if current_phase is not None:
        task.current_phase = current_phase
    if scratchpad is not None:
        task.scratchpad = scratchpad

    db.commit()
    db.refresh(task)
    return task


def retry_task(db: Session, *, task_id: UUID) -> AgentTask | None:
    """Reset a failed/cancelled task to pending for retry."""
    task = get_task(db, task_id=task_id)
    if task is None:
        return None

    # Only allow retry for failed or cancelled tasks
    if task.status not in [AgentTaskStatus.FAILED.value, AgentTaskStatus.CANCELLED.value]:
        return None

    task.status = AgentTaskStatus.PENDING.value
    task.celery_task_id = None
    task.worker_node = None
    task.error_message = None

    db.commit()
    db.refresh(task)
    return task


__all__ = [
    "create_task",
    "get_task",
    "list_tasks",
    "update_status",
    "retry_task",
]
