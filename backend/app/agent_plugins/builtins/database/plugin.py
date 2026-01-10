from typing import Any, List
import json
import uuid
from sqlalchemy import select
from pydantic import BaseModel, Field

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.models.provider_preset import ProviderPreset
from app.core.database import AsyncSessionLocal

class CreateProviderInput(BaseModel):
    name: str
    slug: str
    base_url: str
    auth_type: str = Field(..., description="bearer, api_key, or none")
    auth_config_key: str = Field(..., description="The key name for the secret (e.g. OPENAI_API_KEY)")

class CreateModelInput(BaseModel):
    provider_slug: str
    capability: str = Field("chat", description="chat, image_generation, text_to_speech, video_generation")
    model_name: str
    unified_model_id: str
    upstream_path: str
    template_engine: str = "simple_replace"
    request_template: str = Field(..., description="JSON string or Jinja2 template for request")
    response_transform: str | None = Field(None, description="JSON string or Jinja2 template for response mapping")

class UpdateModelInput(BaseModel):
    provider_slug: str
    model_name: str
    request_template: str | None = Field(None, description="New request template (optional)")
    response_transform: str | None = Field(None, description="New response transform template (optional)")
    template_engine: str | None = Field(None, description="New engine type (optional)")
    upstream_path: str | None = Field(None, description="New upstream path (optional)")

class DatabasePlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system/database_manager",
            version="0.3.0",
            description="Manage Provider Presets and Models (Multi-modal support).",
            author="System"
        )

    def get_tools(self) -> List[Any]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "check_provider_exists",
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
                    "description": "Create a new Provider Preset (Vendor).",
                    "parameters": CreateProviderInput.model_json_schema()
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "create_model_config",
                    "description": "Create a new Model Config (Item) under a Provider.",
                    "parameters": CreateModelInput.model_json_schema()
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "update_model_config",
                    "description": "Update an existing Model Config.",
                    "parameters": UpdateModelInput.model_json_schema()
                }
            }
        ]

    # --- Tool Implementations ---

    async def check_provider_exists(self, slug: str) -> str:
        async with AsyncSessionLocal() as session:
            stmt = select(ProviderPreset).where(ProviderPreset.slug == slug)
            result = await session.execute(stmt)
            preset = result.scalars().first()
            if preset:
                return f"Provider '{slug}' exists (ID: {preset.id})"
            return f"Provider '{slug}' does not exist."

    async def create_provider_preset(self, args: dict) -> str:
        try:
            input_data = CreateProviderInput(**args)
            async with AsyncSessionLocal() as session:
                new_preset = ProviderPreset(
                    id=uuid.uuid4(),
                    name=input_data.name,
                    slug=input_data.slug,
                    provider=input_data.slug,
                    base_url=input_data.base_url,
                    auth_type=input_data.auth_type,
                    auth_config={"secret_ref_id": input_data.auth_config_key},
                    is_active=True
                )
                session.add(new_preset)
                await session.commit()
                return f"Successfully created provider: {input_data.name} ({input_data.slug})"
        except Exception as e:
            return f"Error creating provider: {str(e)}"

    async def create_model_config(self, args: dict) -> str:
        return "Legacy create_model_config is disabled. Use provider_instance + provider_model APIs."

    async def update_model_config(self, args: dict) -> str:
        # Legacy path disabled in favor of provider_instance + provider_model APIs
        return "Update model via provider_model not implemented in legacy plugin. Please use provider_instance + provider_model APIs."

    def _parse_template(self, template_str: str) -> Any:
        try:
            return json.loads(template_str)
        except:
            return template_str
