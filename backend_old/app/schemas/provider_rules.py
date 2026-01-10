from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict


class RuleGenerateRequest(BaseModel):
    """Request body for generating provider rules from sample response."""

    provider_slug: str = Field(..., description="Provider slug to generate rules for")
    sample_response: dict[str, Any] = Field(..., description="Sample /models response from provider")


class MappingGenerateRequest(BaseModel):
    """Request body for generating parameter mappings (input_map/output_map)."""

    provider_slug: str = Field(..., description="Provider slug to generate mappings for")
    service_type: str = Field(..., description="Service type, e.g. 'audio', 'video', 'image'")
    unified_schema_json: str = Field(..., description="JSON string representing the target standard schema")


class RuleGenerateResponse(BaseModel):
    """Response model for rule generation."""

    provider_slug: str
    jmespath_rule: str
    capability_rules: list[dict[str, Any]]
    metadata: dict[str, Any]


class MappingGenerateResponse(BaseModel):
    """Response model for mapping generation."""

    provider_slug: str
    service_type: str
    input_map: dict[str, Any]
    output_map: dict[str, Any]
    metadata: dict[str, Any] | None = None


class ProviderMetadataResponse(BaseModel):
    """Response model for a single provider metadata entry."""

    id: UUID
    provider_slug: str
    name: str | None
    base_url: str
    auth_config: dict[str, Any]
    endpoints_config: dict[str, Any] | None
    model_list_config: dict[str, Any] | None
    is_active: bool
    version: str
    last_verified_at: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProviderMetadataListResponse(BaseModel):
    """Response model for listing provider metadata."""

    items: list[ProviderMetadataResponse]
    total: int
    page: int
    page_size: int


class RollbackRequest(BaseModel):
    """Request body for rolling back to a previous version."""

    version: str = Field(..., description="Version to rollback to")


__all__ = [
    "RuleGenerateRequest",
    "RuleGenerateResponse",
    "ProviderMetadataResponse",
    "ProviderMetadataListResponse",
    "RollbackRequest",
]
