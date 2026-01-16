from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema, IDSchema, TimestampSchema


class McpToolCategory(str, Enum):
    DEVELOPER = "developer"
    PRODUCTIVITY = "productivity"
    SEARCH = "search"
    DATA = "data"
    OTHER = "other"


class McpRuntimeType(str, Enum):
    NODE = "node"
    PYTHON = "python"
    DOCKER = "docker"
    BINARY = "binary"


class McpEnvVarSchema(BaseSchema):
    key: str = Field(..., min_length=1, max_length=120)
    label: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=500)
    required: bool = True
    secret: bool = True
    default: str | None = Field(None, max_length=500)


class McpInstallManifest(BaseSchema):
    runtime: McpRuntimeType
    command: str = Field(..., min_length=1, max_length=200)
    args: list[str] = Field(default_factory=list)
    env_config: list[McpEnvVarSchema] = Field(default_factory=list)


class McpMarketToolSummary(IDSchema, TimestampSchema):
    identifier: str
    name: str
    description: str
    avatar_url: str | None = None
    category: McpToolCategory
    tags: list[str] = Field(default_factory=list)
    author: str
    is_official: bool
    download_count: int


class McpMarketToolDetail(McpMarketToolSummary):
    install_manifest: McpInstallManifest


class McpSubscriptionCreateRequest(BaseSchema):
    tool_id: UUID
    alias: str | None = Field(None, max_length=100)


class McpSubscriptionItem(IDSchema, TimestampSchema):
    user_id: UUID
    market_tool_id: UUID
    alias: str | None = None
    config_hash_snapshot: str | None = None
    tool: McpMarketToolSummary
