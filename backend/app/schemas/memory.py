from __future__ import annotations

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


__all__ = ["MemoryItem", "MemoryListResponse", "MemoryUpdateRequest"]
