from typing import Any, Dict, List, Optional
from uuid import UUID

from app.plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.plugins.builtins.preset_capability_plugin import update_preset_capabilities_db
from app.logging_config import logger

class ProviderRegistryPlugin(AgentPlugin):
    """
    Provider Registry 插件。
    允许 Agent 安全地读取和更新 Provider 预设信息。
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.registry.provider",
            version="1.0.0",
            description="Manage provider presets and their capabilities.",
            author="Gemini CLI"
        )

    def get_tools(self) -> List[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "update_provider_capabilities",
                    "description": "Update the capabilities metadata for a specific provider preset.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "preset_id": {
                                "type": "string", 
                                "description": "The ID of the provider preset (e.g. 'openai', 'anthropic')"
                            },
                            "capabilities": {
                                "type": "object",
                                "description": "The capabilities JSON object (model lists, features, etc.)"
                            }
                        },
                        "required": ["preset_id", "capabilities"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_provider_preset",
                    "description": "Get current information about a provider preset.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "preset_id": {"type": "string", "description": "The preset ID"}
                        },
                        "required": ["preset_id"]
                    }
                }
            }
        ]

    # --- Handlers ---

    def handle_update_provider_capabilities(self, preset_id: str, capabilities: Dict[str, Any]) -> str:
        db = self.context.get_db_session()
        try:
            result = update_preset_capabilities_db(db, preset_id, capabilities)
            logger.info(f"Updated capabilities for {preset_id}")
            return f"Successfully updated capabilities for {preset_id}. Schema version: {result.get('schema_version')}"
        except Exception as e:
            logger.error(f"Failed to update capabilities: {e}")
            return f"Error: {str(e)}"
        finally:
            db.close()

    def handle_get_provider_preset(self, preset_id: str) -> str:
        # 这里简单模拟读取，实际应从 DB 读取
        db = self.context.get_db_session()
        try:
            # 假设有一个简单的查询逻辑 (这里简化演示)
            # from app.models import ProviderPreset
            # preset = db.query(ProviderPreset).get(preset_id)
            # return preset.json() if preset else "Not found"
            return f"Current info for {preset_id} (Stub)"
        finally:
            db.close()
