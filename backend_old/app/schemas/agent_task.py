from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict

from app.models.agent_task import AgentTaskStatus, AgentTaskType


class AgentTaskCreateRequest(BaseModel):
    """Request body for creating a new agent task."""

    task_type: AgentTaskType = Field(
        ...,
        description="Task type: crawl, upload, rule_gen, or preset_discover",
    )
    target_url: str | None = Field(None, description="Target URL for crawl tasks")
    target_file_path: str | None = Field(None, description="Target file path for upload tasks")
    provider_slug: str | None = Field(None, description="Related provider slug")
    depth: int = Field(1, ge=1, le=10, description="Crawl depth (for crawl tasks)")
    max_pages: int = Field(10, ge=1, le=1000, description="Maximum pages to crawl")
    tags: list[str] | None = Field(None, description="Tags for categorization")
    config: dict[str, Any] | None = Field(None, description="Additional JSON configuration")


class AgentTaskResponse(BaseModel):
    """Response model for a single agent task."""

    id: UUID
    task_type: str
    status: AgentTaskStatus
    target_url: str | None
    target_file_path: str | None
    provider_slug: str | None
    depth: int
    max_pages: int
    tags: list[str] | None
    config: dict[str, Any] | None
    steps: list[dict[str, Any]] | None
    progress: int | None
    current_phase: str | None
    scratchpad: dict[str, Any] | None
    celery_task_id: str | None
    worker_node: str | None
    result_summary: dict[str, Any] | None
    error_message: str | None
    created_by_id: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AgentTaskListResponse(BaseModel):
    """Response model for listing agent tasks."""

    items: list[AgentTaskResponse]
    total: int
    page: int
    page_size: int


__all__ = [
    "AgentTaskCreateRequest",
    "AgentTaskResponse",
    "AgentTaskListResponse",
]
