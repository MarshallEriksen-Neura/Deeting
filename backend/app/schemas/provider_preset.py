"""Provider preset DTOs for admin APIs."""

from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema


class ProviderPresetDTO(BaseSchema):
    id: UUID | None = None
    slug: str | None = None
    name: str | None = None
    provider: str | None = None
    category: str | None = None
    base_url: str | None = None
    url_template: str | None = None
    theme_color: str | None = None
    icon: str | None = None
    auth_type: str | None = None
    auth_config: dict[str, Any] = Field(default_factory=dict)
    protocol_schema_version: str | None = None
    protocol_profiles: dict[str, Any] = Field(default_factory=dict)
    version: int = 1
    is_active: bool = True


ProviderPresetBase = ProviderPresetDTO
ProviderPresetCreate = ProviderPresetDTO
ProviderPresetUpdate = ProviderPresetDTO


class ProviderWish(BaseSchema):
    provider_name: str
    description: str | None = None
    url: str | None = None
