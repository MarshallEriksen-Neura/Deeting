import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

McpServerType = Literal["sse", "stdio"]


class UserMcpServerBase(BaseModel):
    name: str = Field(
        ..., max_length=120, description="Display name for the MCP server"
    )
    description: str | None = Field(None, description="Optional description")
    sse_url: HttpUrl | None = Field(
        None, description="Full URL to the MCP SSE endpoint"
    )
    is_enabled: bool = Field(True, description="Whether the server is enabled")
    server_type: McpServerType = Field(
        "sse", description="Server type: sse (remote) or stdio (draft)"
    )
    auth_type: str = Field("bearer", description="bearer, api_key, or none")


class UserMcpServerCreate(UserMcpServerBase):
    """Schema for creating a new MCP server configuration."""

    secret_value: str | None = Field(
        None, description="The actual API Key/Token value (write-only)"
    )
    draft_config: dict[str, Any] | None = Field(
        None, description="Sanitized draft config for stdio imports"
    )


class UserMcpServerUpdate(BaseModel):
    """Schema for updating an existing MCP server."""

    name: str | None = Field(None, max_length=120)
    description: str | None = None
    sse_url: HttpUrl | None = None
    is_enabled: bool | None = None
    server_type: McpServerType | None = None
    auth_type: str | None = None
    secret_value: str | None = None
    draft_config: dict[str, Any] | None = None


class UserMcpServerResponse(UserMcpServerBase):
    """Schema for returning MCP server details."""

    id: uuid.UUID
    user_id: uuid.UUID
    source_id: uuid.UUID | None = None
    source_key: str | None = None
    created_at: Any
    updated_at: Any
    secret_ref_id: str | None = Field(
        None, description="Reference ID for the stored secret"
    )
    tools_count: int = Field(0, description="Number of cached tools")
    status: str = Field("unknown", description="Sync status: active, error, unknown")

    model_config = ConfigDict(from_attributes=True)

    @staticmethod
    def from_orm_model(model: Any) -> "UserMcpServerResponse":
        # Helper to calculate tools count from the JSON list
        count = len(model.tools_cache) if model.tools_cache else 0
        return UserMcpServerResponse(
            id=model.id,
            user_id=model.user_id,
            source_id=getattr(model, "source_id", None),
            source_key=getattr(model, "source_key", None),
            name=model.name,
            description=model.description,
            sse_url=model.sse_url,
            is_enabled=model.is_enabled,
            server_type=model.server_type,
            auth_type=model.auth_type,
            created_at=model.created_at,
            updated_at=model.updated_at,
            secret_ref_id=model.secret_ref_id,
            tools_count=count,
            # Simple heuristic for status
            status=(
                "draft"
                if model.server_type == "stdio"
                else ("active" if model.is_enabled and count > 0 else "inactive")
            ),
        )


class McpServerToolItem(BaseModel):
    name: str = Field(..., description="Tool name")
    description: str | None = Field(None, description="Tool description")
    input_schema: dict[str, Any] = Field(
        default_factory=dict, description="JSON Schema for tool arguments"
    )
    enabled: bool = Field(True, description="Whether this tool is enabled")


class McpServerToolToggleRequest(BaseModel):
    enabled: bool = Field(..., description="Whether to enable this tool")


class McpToolTestRequest(BaseModel):
    server_id: uuid.UUID
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class McpToolTestResponse(BaseModel):
    status: Literal["success", "error"]
    result: Any | None = None
    error: str | None = None
    logs: list[str] = Field(default_factory=list)
    trace_id: str
