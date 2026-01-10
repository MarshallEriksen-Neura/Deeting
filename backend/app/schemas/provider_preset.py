"""
Legacy placeholder for removed provider_preset_item schemas.
Kept to satisfy imports in tests; new code should use provider_instance/provider_model flows.
"""
from app.schemas.base import BaseSchema


class ProviderPresetDTO(BaseSchema):
    slug: str | None = None
    name: str | None = None
    provider: str | None = None
    base_url: str | None = None


# Backward-compat exports
ProviderPresetBase = ProviderPresetDTO
ProviderPresetCreate = ProviderPresetDTO
ProviderPresetUpdate = ProviderPresetDTO
ProviderPresetItemBase = ProviderPresetDTO
ProviderPresetItemCreate = ProviderPresetDTO
ProviderPresetItemUpdate = ProviderPresetDTO
ProviderPresetItemDTO = ProviderPresetDTO
