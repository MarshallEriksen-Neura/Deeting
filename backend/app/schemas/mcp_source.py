from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, HttpUrl

McpSourceType = Literal["local", "cloud", "modelscope", "github", "url"]
McpSourceTrustLevel = Literal["official", "community", "private"]
McpSourceStatus = Literal["active", "inactive", "syncing", "error", "draft"]


class UserMcpSourceBase(BaseModel):
    name: str = Field(..., max_length=120, description="Display name for the MCP source")
    source_type: McpSourceType = Field("url", description="Source type")
    path_or_url: HttpUrl = Field(..., description="Source URL for MCP provider feed")
    trust_level: McpSourceTrustLevel = Field("community", description="Trust level for this source")
    status: McpSourceStatus = Field("active", description="Sync status")
    is_read_only: bool = Field(False, description="Whether this source is read-only")


class UserMcpSourceCreate(BaseModel):
    """Schema for creating a new MCP source subscription."""

    name: str = Field(..., max_length=120)
    source_type: McpSourceType = Field("url")
    path_or_url: HttpUrl
    trust_level: McpSourceTrustLevel = Field("community")


class UserMcpSourceResponse(UserMcpSourceBase):
    id: uuid.UUID
    user_id: uuid.UUID
    last_synced_at: Optional[datetime] = None
    created_at: Any
    updated_at: Any

    class Config:
        from_attributes = True

    @staticmethod
    def from_orm_model(model: Any) -> "UserMcpSourceResponse":
        return UserMcpSourceResponse(
            id=model.id,
            user_id=model.user_id,
            name=model.name,
            source_type=model.source_type,
            path_or_url=model.path_or_url,
            trust_level=model.trust_level,
            status=model.status,
            is_read_only=model.is_read_only,
            last_synced_at=model.last_synced_at,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )


class McpSourceSyncRequest(BaseModel):
    auth_token: Optional[str] = Field(None, description="Optional auth token for source fetch")


class McpSourceSyncResponse(BaseModel):
    source: UserMcpSourceResponse
    created: int = 0
    updated: int = 0
    skipped: int = 0
