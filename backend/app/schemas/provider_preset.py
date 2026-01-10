"""
Legacy placeholder for removed provider_preset_item schemas.
Kept to satisfy imports in tests; new code should use provider_instance/provider_model flows.
"""
from uuid import UUID
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
