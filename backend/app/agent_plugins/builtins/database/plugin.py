from typing import Any, List
from sqlalchemy import select
from pydantic import BaseModel, Field

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.models.provider_preset import ProviderPreset, ProviderPresetItem
from app.core.database import AsyncSessionLocal

class CreateProviderInput(BaseModel):
    name: str
    slug: str
    base_url: str
    auth_type: str = Field(..., description="bearer, api_key, or none")
    auth_config_key: str = Field(..., description="The key name for the secret (e.g. OPENAI_API_KEY)")

class CreateModelInput(BaseModel):
    provider_slug: str
    model_name: str
    unified_model_id: str
    upstream_path: str
    template_engine: str = "simple_replace"
    request_template: str = Field(..., description="JSON string or Jinja2 template")

class UpdateModelInput(BaseModel):
    provider_slug: str
    model_name: str
    request_template: str | None = Field(None, description="New JSON string or Jinja2 template (optional)")
    template_engine: str | None = Field(None, description="New engine type (optional)")
    upstream_path: str | None = Field(None, description="New upstream path (optional)")

class DatabasePlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system/database_manager",
            version="0.2.0",
            description="Manage Provider Presets and Models (Create/Update).",
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
        # In a real agent loop, args come from the LLM
        import uuid
        try:
            input_data = CreateProviderInput(**args)
            async with AsyncSessionLocal() as session:
                new_preset = ProviderPreset(
                    id=uuid.uuid4(),
                    name=input_data.name,
                    slug=input_data.slug,
                    provider=input_data.slug, # simple assumption
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
        import uuid
        import json
        try:
            input_data = CreateModelInput(**args)
            
            # Parse template if it's a JSON string
            try:
                template_obj = json.loads(input_data.request_template)
            except:
                # If not valid JSON, treat as string (Jinja2 raw string)
                template_obj = input_data.request_template

            async with AsyncSessionLocal() as session:
                # Find ID by slug
                stmt = select(ProviderPreset).where(ProviderPreset.slug == input_data.provider_slug)
                result = await session.execute(stmt)
                preset = result.scalars().first()
                if not preset:
                    return f"Error: Provider '{input_data.provider_slug}' not found."

                new_item = ProviderPresetItem(
                    id=uuid.uuid4(),
                    preset_id=preset.id,
                    capability="chat", # Defaulting to chat for now
                    model=input_data.model_name,
                    unified_model_id=input_data.unified_model_id,
                    upstream_path=input_data.upstream_path,
                    template_engine=input_data.template_engine,
                    request_template=template_obj,
                    is_active=True
                )
                session.add(new_item)
                await session.commit()
                return f"Successfully configured model '{input_data.model_name}' for provider '{input_data.provider_slug}'."
        except Exception as e:
            return f"Error creating model config: {str(e)}"

    async def update_model_config(self, args: dict) -> str:
        import json
        try:
            input_data = UpdateModelInput(**args)
            async with AsyncSessionLocal() as session:
                # 1. Find Provider
                stmt = select(ProviderPreset).where(ProviderPreset.slug == input_data.provider_slug)
                result = await session.execute(stmt)
                preset = result.scalars().first()
                if not preset:
                    return f"Error: Provider '{input_data.provider_slug}' not found."

                # 2. Find Model Item
                # We assume model_name matches 'model' field
                stmt = select(ProviderPresetItem).where(
                    ProviderPresetItem.preset_id == preset.id,
                    ProviderPresetItem.model == input_data.model_name
                )
                result = await session.execute(stmt)
                item = result.scalars().first()
                if not item:
                    return f"Error: Model '{input_data.model_name}' not found under provider '{input_data.provider_slug}'."

                # 3. Update Fields
                updates = []
                if input_data.upstream_path:
                    item.upstream_path = input_data.upstream_path
                    updates.append("upstream_path")
                
                if input_data.template_engine:
                    item.template_engine = input_data.template_engine
                    updates.append("template_engine")

                if input_data.request_template:
                    try:
                        template_obj = json.loads(input_data.request_template)
                    except:
                        template_obj = input_data.request_template
                    item.request_template = template_obj
                    updates.append("request_template")

                if not updates:
                    return "No changes provided."

                await session.commit()
                return f"Successfully updated model '{input_data.model_name}': {', '.join(updates)}."

        except Exception as e:
            return f"Error updating model config: {str(e)}"
