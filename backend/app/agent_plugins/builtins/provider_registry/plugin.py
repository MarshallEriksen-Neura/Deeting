from typing import Any

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.schemas.gateway_fields import (
    AUDIO_ONLY_FIELDS,
    CHAT_FIELDS,
    COMMON_FIELDS,
    IMAGE_ONLY_FIELDS,
    VIDEO_ONLY_FIELDS,
)


class ProviderRegistryPlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.registry.provider",
            version="1.0.0",
            description="Manage provider presets and database configuration.",
            author="Gemini CLI"
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "save_provider_field_mapping",
                    "description": "Save the mapping rules between Gateway Unified Fields and Provider Specific Fields.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "provider_id": {"type": "string"},
                            "capability": {"type": "string", "enum": ["chat", "image", "audio", "video"]},
                            "mapping": {
                                "type": "object",
                                "description": "JSON object mapping INTERNAL GATEWAY fields (keys) to PROVIDER fields (values). e.g. {'max_tokens': 'max_completion_tokens'}"
                            }
                        },
                        "required": ["provider_id", "capability", "mapping"]
                    }
                }
            }
        ]

    async def handle_save_provider_field_mapping(self, provider_id: str, capability: str, mapping: dict[str, Any]) -> str:
        # Validate keys against Gateway Schema
        valid_fields = COMMON_FIELDS.copy()
        if capability == "chat":
            valid_fields.update(CHAT_FIELDS)
        elif capability == "image":
            valid_fields.update(IMAGE_ONLY_FIELDS)
        elif capability == "audio":
            valid_fields.update(AUDIO_ONLY_FIELDS)
        elif capability == "video":
            valid_fields.update(VIDEO_ONLY_FIELDS)

        # Check validation
        invalid_keys = []
        for key in mapping.keys():
            if key not in valid_fields:
                invalid_keys.append(key)

        if invalid_keys:
            return f"Validation Error: The following keys are NOT valid Gateway fields: {invalid_keys}. Please check the schema in gateway_fields.py."

        # Mock saving to DB
        logger = self.context.get_logger()
        logger.info(f"Saving mapping for {provider_id} [{capability}]: {mapping}")

        # TODO: Actual DB Update using self.context.get_db_session()
        # db = self.context.get_db_session()
        # try:
        #     # Logic to update ProviderPresetItem
        #     pass
        # finally:
        #     await db.close()

        return "Mapping saved successfully."
