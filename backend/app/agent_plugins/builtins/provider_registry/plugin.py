from typing import Any, List, Dict, Optional
import logging

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.schemas.unified_capabilities import CAPABILITY_MAP
from app.core.database import AsyncSessionLocal
from app.repositories.provider_preset_repository import ProviderPresetRepository

logger = logging.getLogger(__name__)

class ProviderRegistryPlugin(AgentPlugin):
    """
    Expert plugin for discovering and registering AI Providers.
    Provides the 'Source of Truth' for internal schemas and updates the Registry (ProviderPreset).
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.registry.provider",
            version="2.1.0",
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
            },
            {
                "type": "function",
                "function": {
                    "name": "save_provider_field_mapping",
                    "description": "Save the configuration (templates, headers, async flow) for a provider's capability to the Registry (ProviderPreset).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "provider_slug": {
                                "type": "string",
                                "description": "The unique slug of the provider (e.g. 'modelscope-standard')"
                            },
                            "capability": {
                                "type": "string",
                                "description": "The capability being configured (e.g. 'image_generation', 'chat')"
                            },
                            "request_template": {
                                "type": "object",
                                "description": "Jinja2 template for the request body. Keys should match upstream API fields. Values can use {{ input.field }}. "
                            },
                            "response_transform": {
                                "type": "object",
                                "description": "Optional mapping to transform upstream response to standard format."
                            },
                            "default_headers": {
                                "type": "object",
                                "description": "Headers to include in every request (e.g. {'X-ModelScope-Async-Mode': 'true'})."
                            },
                            "default_params": {
                                "type": "object",
                                "description": "Default parameter values."
                            },
                            "async_config": {
                                "type": "object",
                                "description": "Configuration for asynchronous polling (FSM), if applicable."
                            }
                        },
                        "required": ["provider_slug", "capability", "request_template"]
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

    async def handle_save_provider_field_mapping(
        self,
        provider_slug: str,
        capability: str,
        request_template: Dict[str, Any],
        response_transform: Optional[Dict[str, Any]] = None,
        default_headers: Optional[Dict[str, Any]] = None,
        default_params: Optional[Dict[str, Any]] = None,
        async_config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Handler for saving provider mapping to ProviderPreset.capability_configs.
        """
        async with AsyncSessionLocal() as session:
            repo = ProviderPresetRepository(session)
            preset = await repo.get_by_slug(provider_slug)
            
            if not preset:
                # Optionally create a placeholder preset if implied?
                # For now, require it to exist.
                return {
                    "status": "error", 
                    "message": f"Provider preset '{provider_slug}' not found. Please create the preset first."
                }

            # 1. Load current configs (copy to avoid mutation issues)
            current_configs = dict(preset.capability_configs or {})
            
            # 2. Prepare new config for this capability
            # Merge with existing if present to preserve other fields?
            # Or overwrite? Usually overwrite based on new crawl data is safer for consistency.
            cap_config = current_configs.get(capability, {})
            
            # Enforce Jinja2 if we are setting a template
            cap_config["template_engine"] = "jinja2"
            cap_config["request_template"] = request_template
            
            if response_transform is not None:
                cap_config["response_transform"] = response_transform
            if default_headers is not None:
                cap_config["default_headers"] = default_headers
            if default_params is not None:
                cap_config["default_params"] = default_params
            if async_config is not None:
                cap_config["async_config"] = async_config
            
            # 3. Update top-level config
            current_configs[capability] = cap_config
            
            # 4. Save
            await repo.update(preset, {"capability_configs": current_configs})
            
            logger.info(f"Agent updated preset '{provider_slug}' capability '{capability}'.")
            
            return {
                "status": "success",
                "message": f"Successfully updated configuration for '{provider_slug}' / '{capability}'.",
                "preview": cap_config
            }
