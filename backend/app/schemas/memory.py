from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema


class MemoryItem(BaseSchema):
    """
    单条记忆项
    """

    id: str = Field(..., description="记忆唯一 ID (UUID)")
    content: str = Field(..., description="记忆内容")
    payload: dict[str, Any] = Field(default_factory=dict, description="元数据")
    score: float | None = Field(None, description="搜索得分 (列表时为 None)")


class MemoryListResponse(BaseSchema):
    """
    记忆列表响应
    """

    items: list[MemoryItem]
    next_cursor: str | None = Field(None, description="分页游标")


class MemoryUpdateRequest(BaseSchema):
    """
    更新记忆内容的请求
    """

    content: str = Field(..., description="更新后的记忆内容")


class MemorySnapshotItem(BaseSchema):
    """
    Memory audit trail snapshot.
    """

    id: UUID
    user_id: UUID
    memory_point_id: str
    action: str = Field(..., description="Action: update, delete, rollback")
    old_content: str | None = None
    new_content: str | None = None
    old_metadata: dict[str, Any] | None = None
    new_metadata: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class MemorySnapshotListResponse(BaseSchema):
    """
    Memory snapshot list response.
    """

    items: list[MemorySnapshotItem]


class MemoryRollbackRequest(BaseSchema):
    """
    Request to rollback a memory to a previous snapshot state.
    """

    snapshot_id: UUID = Field(..., description="Snapshot ID to rollback to")


class MemoryRollbackResponse(BaseSchema):
    """
    Rollback result.
    """

    success: bool
    memory_point_id: str
    restored_content: str | None = None


class WriteGuardResult(BaseSchema):
    """
    Write Guard deduplication result.
    """

    action: str = Field(..., description="add, update, or noop")
    memory_id: str | None = None
    similarity_score: float | None = None


__all__ = [
    "MemoryItem",
    "MemoryListResponse",
    "MemoryUpdateRequest",
    "MemorySnapshotItem",
    "MemorySnapshotListResponse",
    "MemoryRollbackRequest",
    "MemoryRollbackResponse",
    "WriteGuardResult",
]
