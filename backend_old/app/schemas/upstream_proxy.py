from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class UpstreamProxyConfigResponse(BaseModel):
    id: UUID
    enabled: bool
    selection_strategy: str
    failure_cooldown_seconds: int = Field(ge=0)
    healthcheck_url: str
    healthcheck_timeout_ms: int = Field(ge=100)
    healthcheck_method: str
    healthcheck_interval_seconds: int = Field(ge=10)
    created_at: datetime
    updated_at: datetime


class UpstreamProxyConfigUpdateRequest(BaseModel):
    enabled: bool | None = None
    selection_strategy: str | None = None
    failure_cooldown_seconds: int | None = Field(default=None, ge=0)
    healthcheck_url: str | None = None
    healthcheck_timeout_ms: int | None = Field(default=None, ge=100)
    healthcheck_method: str | None = None
    healthcheck_interval_seconds: int | None = Field(default=None, ge=10)


class UpstreamProxySourceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    source_type: str = Field(
        default="static_list",
        description="static_list / remote_text_list",
    )
    enabled: bool = True
    default_scheme: str = Field(default="http", description="http/https/socks5/socks5h")
    refresh_interval_seconds: int | None = Field(default=None, ge=30)

    # remote_text_list only
    remote_url: str | None = Field(default=None, description="远程代理列表 URL（可包含 token，后端加密存储）")
    remote_headers: dict[str, Any] | None = Field(default=None, description="远程拉取时附带的 headers（后端加密存储）")

    # optional overrides
    healthcheck_url: str | None = None
    healthcheck_timeout_ms: int | None = Field(default=None, ge=100)
    healthcheck_method: str | None = None


class UpstreamProxySourceUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    enabled: bool | None = None
    default_scheme: str | None = None
    refresh_interval_seconds: int | None = Field(default=None, ge=30)
    remote_url: str | None = None
    remote_headers: dict[str, Any] | None = None
    healthcheck_url: str | None = None
    healthcheck_timeout_ms: int | None = Field(default=None, ge=100)
    healthcheck_method: str | None = None


class UpstreamProxySourceResponse(BaseModel):
    id: UUID
    name: str
    source_type: str
    enabled: bool
    default_scheme: str
    refresh_interval_seconds: int | None
    last_refresh_at: datetime | None
    last_refresh_error: str | None
    remote_url_masked: str | None = None
    remote_headers_masked: dict[str, Any] | None = None
    healthcheck_url: str | None
    healthcheck_timeout_ms: int | None
    healthcheck_method: str | None
    created_at: datetime
    updated_at: datetime


class UpstreamProxySourcesResponse(BaseModel):
    sources: list[UpstreamProxySourceResponse]
    total: int


class UpstreamProxyEndpointCreateRequest(BaseModel):
    source_id: UUID
    scheme: str = Field(description="http/https/socks5/socks5h")
    host: str
    port: int = Field(ge=1, le=65535)
    username: str | None = None
    password: str | None = None
    enabled: bool = True


class UpstreamProxyEndpointUpdateRequest(BaseModel):
    enabled: bool | None = None


class UpstreamProxyEndpointResponse(BaseModel):
    id: UUID
    source_id: UUID
    scheme: str
    host: str
    port: int
    username: str | None
    has_password: bool
    enabled: bool
    last_seen_at: datetime | None
    last_check_at: datetime | None
    last_ok: bool | None
    last_latency_ms: float | None
    consecutive_failures: int
    last_error: str | None
    created_at: datetime
    updated_at: datetime


class UpstreamProxyEndpointsResponse(BaseModel):
    endpoints: list[UpstreamProxyEndpointResponse]
    total: int


class UpstreamProxyImportRequest(BaseModel):
    source_id: UUID
    text: str = Field(description="支持逗号/换行/分号分隔；支持 ip:port、ip:port:user:pass、完整 URL")
    default_scheme: str | None = Field(default=None, description="未带 scheme 的行使用该默认 scheme")


class UpstreamProxyImportResponse(BaseModel):
    inserted_or_updated: int


class UpstreamProxyTaskResponse(BaseModel):
    task_id: str


class UpstreamProxyStatusResponse(BaseModel):
    config_enabled: bool
    total_sources: int
    total_endpoints: int
    available_endpoints: int


__all__ = [
    "UpstreamProxyConfigResponse",
    "UpstreamProxyConfigUpdateRequest",
    "UpstreamProxyEndpointCreateRequest",
    "UpstreamProxyEndpointResponse",
    "UpstreamProxyEndpointUpdateRequest",
    "UpstreamProxyEndpointsResponse",
    "UpstreamProxyImportRequest",
    "UpstreamProxyImportResponse",
    "UpstreamProxySourceCreateRequest",
    "UpstreamProxySourceResponse",
    "UpstreamProxySourceUpdateRequest",
    "UpstreamProxySourcesResponse",
    "UpstreamProxyStatusResponse",
    "UpstreamProxyTaskResponse",
]
