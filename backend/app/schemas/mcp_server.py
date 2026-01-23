from typing import Any, Dict, List, Optional
import uuid
from pydantic import BaseModel, Field, HttpUrl

from app.models.provider_preset import JSONBCompat

class UserMcpServerBase(BaseModel):
    name: str = Field(..., max_length=120, description="Display name for the MCP server")
    description: Optional[str] = Field(None, description="Optional description")
    sse_url: HttpUrl = Field(..., description="Full URL to the MCP SSE endpoint")
    is_enabled: bool = Field(True, description="Whether the server is enabled")
    auth_type: str = Field("bearer", description="bearer, api_key, or none")

class UserMcpServerCreate(UserMcpServerBase):
    """Schema for creating a new MCP server configuration."""
    secret_value: Optional[str] = Field(None, description="The actual API Key/Token value (write-only)")

class UserMcpServerUpdate(BaseModel):
    """Schema for updating an existing MCP server."""
    name: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = None
    sse_url: Optional[HttpUrl] = None
    is_enabled: Optional[bool] = None
    auth_type: Optional[str] = None
    secret_value: Optional[str] = None

class UserMcpServerResponse(UserMcpServerBase):
    """Schema for returning MCP server details."""
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: Any
    updated_at: Any
    secret_ref_id: Optional[str] = Field(None, description="Reference ID for the stored secret")
    tools_count: int = Field(0, description="Number of cached tools")
    status: str = Field("unknown", description="Sync status: active, error, unknown")

    class Config:
        from_attributes = True

    @staticmethod
    def from_orm_model(model: Any) -> "UserMcpServerResponse":
        # Helper to calculate tools count from the JSON list
        count = len(model.tools_cache) if model.tools_cache else 0
        return UserMcpServerResponse(
            id=model.id,
            user_id=model.user_id,
            name=model.name,
            description=model.description,
            sse_url=model.sse_url,
            is_enabled=model.is_enabled,
            auth_type=model.auth_type,
            created_at=model.created_at,
            updated_at=model.updated_at,
            secret_ref_id=model.secret_ref_id,
            tools_count=count,
            # Simple heuristic for status
            status="active" if model.is_enabled and count > 0 else "inactive"
        )
