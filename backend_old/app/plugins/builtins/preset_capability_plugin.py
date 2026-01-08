from __future__ import annotations

from typing import Any, Dict, List

from app.logging_config import logger
from app.plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.services.provider.metadata_validator import validate_metadata, MetadataValidationError
from app.services.provider_preset_service import get_provider_preset


def update_preset_capabilities_db(db, preset_id: str, capabilities: Dict[str, Any]) -> dict:
    """
    校验并写入 preset 的能力映射。
    """
    preset = get_provider_preset(db, preset_id=preset_id)
    if preset is None:
        raise ValueError(f"Provider preset '{preset_id}' not found")

    validated = validate_metadata({"capabilities": capabilities})

    preset.metadata_json = preset.metadata_json or {}
    preset.metadata_json["capabilities"] = validated.get("capabilities", {})
    preset.metadata_json["schema_version"] = validated.get("schema_version")
    preset.model_list_config = None
    preset.endpoints_config = None

    db.add(preset)
    db.commit()

    return {
        "preset_id": preset.preset_id,
        "capabilities": validated.get("capabilities", {}),
        "schema_version": validated.get("schema_version"),
    }


class PresetCapabilityPlugin(AgentPlugin):
    """
    插件：写入/读取 provider_preset 的能力映射。
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.registry.preset_capability",
            version="1.0.0",
            description="Validate and write capabilities into provider preset metadata_json",
        )

    def get_tools(self) -> List[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "update_preset_capabilities",
                    "description": "Update capabilities for a provider preset",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "preset_id": {"type": "string"},
                            "capabilities": {"type": "object"},
                        },
                        "required": ["preset_id", "capabilities"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_preset_capabilities",
                    "description": "Get capabilities of a provider preset",
                    "parameters": {
                        "type": "object",
                        "properties": {"preset_id": {"type": "string"}},
                        "required": ["preset_id"],
                    },
                },
            },
        ]

    # Handlers
    def handle_update_preset_capabilities(self, preset_id: str, capabilities: Dict[str, Any]) -> str:
        db = self.context.get_db_session()
        try:
            result = update_preset_capabilities_db(db, preset_id, capabilities)
            logger.info(f"Updated capabilities for {preset_id}")
            return f"ok|schema_version={result.get('schema_version')}"
        except MetadataValidationError as e:
            return f"error|validation_failed:{e}"
        except Exception as e:
            return f"error|{e}"
        finally:
            db.close()

    def handle_get_preset_capabilities(self, preset_id: str) -> Dict[str, Any]:
        db = self.context.get_db_session()
        try:
            preset = get_provider_preset(db, preset_id=preset_id)
            if not preset:
                return {"error": "not_found"}
            meta = preset.metadata_json or {}
            return {
                "preset_id": preset_id,
                "capabilities": meta.get("capabilities") or {},
                "schema_version": meta.get("schema_version"),
            }
        finally:
            db.close()


__all__ = ["PresetCapabilityPlugin", "update_preset_capabilities_db"]
