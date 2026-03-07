"""
Legacy placeholder for removed provider_preset_item schemas.
Kept to satisfy imports in tests; new code should use provider_instance/provider_model flows.
"""

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
    template_engine: str | None = None
    response_transform: dict[str, Any] = Field(default_factory=dict)
    auth_type: str | None = None
    auth_config: dict[str, Any] = Field(default_factory=dict)
    default_headers: dict[str, Any] = Field(default_factory=dict)
    default_params: dict[str, Any] = Field(default_factory=dict)
    capability_configs: dict[str, Any] = Field(default_factory=dict)
    protocol_schema_version: str | None = None
    protocol_profiles: dict[str, Any] = Field(default_factory=dict)
    version: int = 1
    is_active: bool = True


# Backward-compat exports
ProviderPresetBase = ProviderPresetDTO
ProviderPresetCreate = ProviderPresetDTO
ProviderPresetUpdate = ProviderPresetDTO
ProviderPresetItemBase = ProviderPresetDTO
ProviderPresetItemCreate = ProviderPresetDTO
ProviderPresetItemUpdate = ProviderPresetDTO
ProviderPresetItemDTO = ProviderPresetDTO


class ProviderWish(BaseSchema):
    provider_name: str
    description: str | None = None
    url: str | None = None
