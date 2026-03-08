from __future__ import annotations

from typing import Any

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.database import AsyncSessionLocal
from app.services.providers.provider_instance_service import ProviderInstanceService


class ProviderProbePlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.tools.provider_probe",
            version="1.0.0",
            description="Probe upstream providers for connectivity and model discovery.",
            author="Deeting Team",
        )

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "probe_provider",
                    "description": "Probe a provider and verify connectivity against the unified provider runtime expectations.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "provider_type": {"type": "string"},
                            "base_url": {"type": "string"},
                            "api_key": {"type": "string"},
                            "model": {"type": "string"},
                            "capability": {"type": "string"},
                            "protocol": {"type": "string"},
                            "auto_append_v1": {"type": "boolean"},
                            "resource_name": {"type": "string"},
                            "deployment_name": {"type": "string"},
                            "project_id": {"type": "string"},
                            "region": {"type": "string"},
                            "api_version": {"type": "string"},
                        },
                        "required": ["provider_type", "base_url", "api_key", "model"],
                    },
                },
            }
        ]

    async def handle_probe_provider(
        self,
        *,
        provider_type: str,
        base_url: str,
        api_key: str,
        model: str | None = None,
        capability: str | None = None,
        protocol: str | None = None,
        auto_append_v1: bool | None = None,
        resource_name: str | None = None,
        deployment_name: str | None = None,
        project_id: str | None = None,
        region: str | None = None,
        api_version: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        resolved_provider = str(provider_type or "").strip() or "openai"
        resolved_protocol = str(protocol or resolved_provider).strip().lower() or "openai"

        async with AsyncSessionLocal() as session:
            service = ProviderInstanceService(session)
            result = await service.verify_credentials(
                preset_slug=resolved_provider,
                base_url=base_url,
                api_key=api_key,
                model=model,
                protocol=resolved_protocol,
                auto_append_v1=auto_append_v1,
                resource_name=resource_name,
                deployment_name=deployment_name,
                project_id=project_id,
                region=region,
                api_version=api_version,
            )

        payload = dict(result or {})
        payload.setdefault("provider_type", resolved_provider)
        if capability:
            payload.setdefault("capability", capability)
        payload.setdefault("protocol", resolved_protocol)
        return payload
