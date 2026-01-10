from typing import Any, List
from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.schemas.unified_capabilities import CAPABILITY_MAP

class ProviderRegistryPlugin(AgentPlugin):
    """
    Expert plugin for discovering and registering AI Providers.
    Provides the 'Source of Truth' for internal schemas.
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.registry.provider",
            version="2.0.0",
            description="Intelligent provider discovery and configuration manager.",
            author="System"
        )

    def get_tools(self) -> List[Any]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "get_unified_schema",
                    "description": "Get the internal standard schema for a specific capability (e.g. image_generation). Use this to know which fields the gateway expects.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "capability": {
                                "type": "string",
                                "enum": list(CAPABILITY_MAP.keys())
                            }
                        },
                        "required": ["capability"]
                    }
                }
            }
        ]

    async def get_unified_schema(self, capability: str) -> str:
        """
        Returns the JSON schema of the internal request and response for a capability.
        This is used by the Agent to align provider mappings.
        """
        if capability not in CAPABILITY_MAP:
            return f"Error: Capability '{capability}' not found."
        
        req_cls, resp_cls = CAPABILITY_MAP[capability]
        
        if req_cls is None:
            # Special case for chat (uses standard ChatCompletionRequest)
            from app.schemas.gateway import ChatCompletionRequest
            return f"Chat Capability Standard:\nRequest Schema: {ChatCompletionRequest.model_json_schema()}"

        return (
            f"Capability: {capability}\n"
            f"Internal Request Schema (Standard Input): {req_cls.model_json_schema()}\n"
            f"Internal Response Schema (Standard Output): {resp_cls.model_json_schema()}"
        )