from typing import Any, List, Optional
import json
import uuid
import logging
from sqlalchemy import select
from pydantic import BaseModel, Field

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.models.provider_preset import ProviderPreset
from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

class CreateProviderPresetInput(BaseModel):
    name: str = Field(..., description="Display name of the provider (e.g. OpenAI)")
    slug: str = Field(..., description="Unique machine-readable identifier (e.g. openai)")
    base_url: str = Field(..., description="Base API URL")
    auth_type: str = Field(..., description="Authentication type: bearer, api_key, or none")
    auth_config_key: Optional[str] = Field(None, description="The key name for the secret reference (e.g. OPENAI_API_KEY)")
    category: Optional[str] = Field("Cloud API", description="Category: Cloud API, Local Hosted, etc.")

class UpdateProviderPresetInput(BaseModel):
    slug: str = Field(..., description="The slug of the preset to update")
    name: Optional[str] = None
    base_url: Optional[str] = None
    category: Optional[str] = None
    default_params: Optional[str] = Field(None, description="JSON string of default parameters (e.g. supported models list)")

class DatabasePlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system/database_manager",
            version="0.5.0",
            description="Manage Provider Presets (Templates).",
            author="System"
        )

    def get_tools(self) -> List[Any]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "check_provider_preset_exists",
                    "description": "Check if a provider preset already exists by slug.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "slug": {"type": "string"}
                        },
                        "required": ["slug"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "create_provider_preset",
                    "description": "Create a new Provider Preset (Vendor Template).",
                    "parameters": CreateProviderPresetInput.model_json_schema()
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "update_provider_preset",
                    "description": "Update an existing Provider Preset with new information.",
                    "parameters": UpdateProviderPresetInput.model_json_schema()
                }
            }
        ]

    # --- Tool Implementations ---

    async def check_provider_preset_exists(self, slug: str) -> str:
        async with AsyncSessionLocal() as session:
            stmt = select(ProviderPreset).where(ProviderPreset.slug == slug)
            result = await session.execute(stmt)
            preset = result.scalars().first()
            if preset:
                return f"Provider Preset '{slug}' exists."
            return f"Provider Preset '{slug}' does not exist."

    async def create_provider_preset(self, args: dict) -> str:
        try:
            input_data = CreateProviderPresetInput(**args)
            async with AsyncSessionLocal() as session:
                # Check duplication
                stmt = select(ProviderPreset).where(ProviderPreset.slug == input_data.slug)
                if (await session.execute(stmt)).scalars().first():
                    return f"Error: Provider Preset '{input_data.slug}' already exists. Use update_provider_preset instead."

                new_preset = ProviderPreset(
                    id=uuid.uuid4(),
                    name=input_data.name,
                    slug=input_data.slug,
                    provider=input_data.slug,
                    base_url=input_data.base_url,
                    auth_type=input_data.auth_type,
                    auth_config={"secret_ref_id": input_data.auth_config_key} if input_data.auth_config_key else {},
                    category=input_data.category,
                    is_active=True
                )
                session.add(new_preset)
                await session.commit()
                return f"Successfully created provider preset: {input_data.name} ({input_data.slug})"
        except Exception as e:
            logger.error(f"create_provider_preset error: {e}")
            return f"Error creating provider preset: {str(e)}"

    async def update_provider_preset(self, args: dict) -> str:
        try:
            input_data = UpdateProviderPresetInput(**args)
            async with AsyncSessionLocal() as session:
                stmt = select(ProviderPreset).where(ProviderPreset.slug == input_data.slug)
                preset = (await session.execute(stmt)).scalars().first()
                if not preset:
                    return f"Error: Provider Preset '{input_data.slug}' not found."

                if input_data.name: preset.name = input_data.name
                if input_data.base_url: preset.base_url = input_data.base_url
                if input_data.category: preset.category = input_data.category
                if input_data.default_params:
                    preset.default_params = self._parse_template(input_data.default_params)

                await session.commit()
                return f"Successfully updated provider preset: {input_data.slug}"
        except Exception as e:
            logger.error(f"update_provider_preset error: {e}")
            return f"Error updating provider preset: {str(e)}"

    def _parse_template(self, template_str: str) -> Any:
        if isinstance(template_str, dict):
            return template_str
        try:
            return json.loads(template_str)
        except:
            return template_str
