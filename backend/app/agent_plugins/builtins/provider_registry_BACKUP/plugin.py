import json
import logging
from typing import Any

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.database import AsyncSessionLocal
from app.core.http_client import create_async_http_client
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.repositories.user_repository import UserRepository
from app.schemas.unified_capabilities import CAPABILITY_MAP
from app.services.providers.request_renderer import request_renderer
from app.utils.security import is_safe_upstream_url

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
            version="2.2.0",  # Bump for Verification Tool
            description="Intelligent provider discovery and configuration manager.",
            author="System",
        )

    def get_tools(self) -> list[Any]:
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
                                "enum": list(CAPABILITY_MAP.keys()),
                            }
                        },
                        "required": ["capability"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "verify_provider_template",
                    "description": "Dry-run a Jinja2 template against a real provider API to verify correctness. DO NOT save until verified.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "base_url": {
                                "type": "string",
                                "description": "Target API Endpoint (e.g. https://api.groq.com/openai/v1/chat/completions)",
                            },
                            "test_api_key": {
                                "type": "string",
                                "description": "A valid API Key for testing.",
                            },
                            "request_template": {
                                "type": "object",
                                "description": "The Jinja2 template draft to test. Variables are available as both top-level keys (e.g. {{ model }}) and under {{ input.* }}.",
                            },
                            "test_payload": {
                                "type": "object",
                                "description": "Simulated user input (e.g. {'model': 'llama3', 'messages': [{'role': 'user', 'content': 'hi'}]}). The payload is exposed to Jinja as top-level keys and as `input`.",
                                "default": {
                                    "model": "default",
                                    "messages": [
                                        {"role": "user", "content": "Hello world"}
                                    ],
                                },
                            },
                            "header_template": {
                                "type": "object",
                                "description": "Headers to include (can use Jinja2).",
                                "default": {
                                    "Content-Type": "application/json",
                                    "Authorization": "Bearer {{ api_key }}",
                                },
                            },
                        },
                        "required": ["base_url", "test_api_key", "request_template"],
                    },
                },
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
                                "description": "The unique slug of the provider (e.g. 'modelscope-standard')",
                            },
                            "capability": {
                                "type": "string",
                                "description": "The capability being configured (e.g. 'image_generation', 'chat')",
                            },
                            "request_template": {
                                "type": "object",
                                "description": "Jinja2 template for the request body. Keys should match upstream API fields. Values can use {{ field }} or {{ input.field }}.",
                            },
                            "response_transform": {
                                "type": "object",
                                "description": "Optional mapping to transform upstream response to standard format.",
                            },
                            "default_headers": {
                                "type": "object",
                                "description": "Headers to include in every request (e.g. {'X-ModelScope-Async-Mode': 'true'}).",
                            },
                            "default_params": {
                                "type": "object",
                                "description": "Default parameter values.",
                            },
                            "async_config": {
                                "type": "object",
                                "description": "Configuration for asynchronous polling (FSM), if applicable.",
                            },
                            "output_mapping": {
                                "type": "object",
                                "description": "Configuration for extracting results from upstream response. Supports 'single_mode' (single URL extraction, e.g. Seedance) and 'items_path'+'item_schema' (array extraction with field mapping).",
                            },
                            "request_builder": {
                                "type": "object",
                                "description": "Structural request transformation config. 'type' selects a registered builder (e.g. 'ark_content_array' for Volcengine Seedance). Additional keys are builder-specific params.",
                            },
                        },
                        "required": ["provider_slug", "capability", "request_template"],
                    },
                },
            },
        ]

    async def get_unified_schema(self, capability: str) -> str:
        """
        Returns the JSON schema of the internal request and response for a capability.
        This is used by the Agent to align provider mappings.
        """
        if capability not in CAPABILITY_MAP:
            available = ", ".join(sorted(CAPABILITY_MAP.keys()))
            return f"Error: Capability '{capability}' not found. Available capabilities: {available}"

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

    async def handle_verify_provider_template(
        self,
        base_url: str,
        test_api_key: str,
        request_template: dict[str, Any],
        test_payload: dict[str, Any],
        header_template: dict[str, Any] = None,
    ) -> str:
        """
        Tool Handler: Verify a draft template by sending a real request.
        """
        # 1. Security Check
        async with AsyncSessionLocal() as session:
            user_repo = UserRepository(session)
            user = await user_repo.get_by_id(self.context.user_id)
            if not user or not user.is_superuser:
                return "Permission Denied: Only admins can perform integration tests."

        # 2. SSRF Check
        if not is_safe_upstream_url(base_url):
            return f"Error: Target URL '{base_url}' is not allowed (SSRF Protection)."

        # 3. Render Body
        try:
            # Provide both namespaces to reduce template coupling:
            # - top-level: {{ model }}
            # - nested: {{ input.model }} / {{ request.model }}
            context = test_payload.copy()
            context["input"] = test_payload
            context["request"] = test_payload
            context["api_key"] = test_api_key  # For header rendering

            # Render Body
            body = request_renderer._render_jinja2(request_template, context)

            # Render Headers
            headers = {}
            if header_template:
                headers = request_renderer._render_jinja2(header_template, context)

        except Exception as e:
            return f"Template Rendering Failed: {e!s}"

        # 4. Send Request (Using unified HTTP Client)
        try:
            client = create_async_http_client(timeout=15.0)
            async with client:
                resp = await client.post(base_url, json=body, headers=headers)

                status_msg = "Success" if resp.is_success else "Provider Error"
                resp_text = (
                    resp.text[:1000] + "..." if len(resp.text) > 1000 else resp.text
                )

                return (
                    f"Verification Result: {status_msg} ({resp.status_code})\n"
                    f"Sent Body: {json.dumps(body, indent=2)}\n"
                    f"Response: {resp_text}"
                )

        except Exception as e:
            return f"Network Request Failed: {e!s}"

    async def handle_save_provider_field_mapping(
        self,
        provider_slug: str,
        capability: str,
        request_template: dict[str, Any],
        response_transform: dict[str, Any] | None = None,
        default_headers: dict[str, Any] | None = None,
        default_params: dict[str, Any] | None = None,
        async_config: dict[str, Any] | None = None,
        output_mapping: dict[str, Any] | None = None,
        request_builder: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Handler for saving provider mapping to ProviderPreset.capability_configs.
        SECURITY: Restricted to Superusers only.
        """
        from app.tasks.search_index import upsert_provider_preset_task

        # 1. Security Check
        async with AsyncSessionLocal() as session:
            user_repo = UserRepository(session)
            user = await user_repo.get_by_id(self.context.user_id)

            if not user or not user.is_superuser:
                logger.warning(
                    f"Unauthorized provider update attempt by user {self.context.user_id}"
                )
                return {
                    "status": "error",
                    "message": "Permission Denied: Only system administrators can modify Provider Presets.",
                }

            # 2. Logic Execution
            repo = ProviderPresetRepository(session)
            preset = await repo.get_by_slug(provider_slug)

            if not preset:
                return {
                    "status": "error",
                    "message": f"Provider preset '{provider_slug}' not found. Please create the preset first.",
                }

            # Load and Update
            current_configs = dict(preset.capability_configs or {})
            cap_config = current_configs.get(capability, {})

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
            if output_mapping is not None:
                cap_config["output_mapping"] = output_mapping
            if request_builder is not None:
                cap_config["request_builder"] = request_builder

            current_configs[capability] = cap_config

            await repo.update(preset, {"capability_configs": current_configs})
            upsert_provider_preset_task.delay(provider_slug)

            logger.info(
                f"Admin {user.username} updated preset '{provider_slug}' capability '{capability}'."
            )

            return {
                "status": "success",
                "message": f"Successfully updated configuration for '{provider_slug}' / '{capability}'.",
                "preview": cap_config,
            }
