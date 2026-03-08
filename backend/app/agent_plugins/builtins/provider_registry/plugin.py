from __future__ import annotations

import json
from typing import Any

from jinja2 import BaseLoader, Environment
from sqlalchemy import select

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.database import AsyncSessionLocal
from app.core.http_client import create_async_http_client
from app.models.provider_preset import ProviderPreset
from app.models.user import User
from app.protocols.canonical import CanonicalRequest
from app.protocols.runtime.profile_resolver import build_protocol_profile
from app.services.providers.request_renderer import SilentUndefined
from app.tasks.search_index import upsert_provider_preset_task
from app.utils.security import is_safe_upstream_url


def _default_upstream_path(capability: str) -> str:
    cap = str(capability or "chat").strip().lower()
    if cap == "embedding":
        return "embeddings"
    if cap == "image_generation":
        return "images/generations"
    if cap == "text_to_speech":
        return "audio/speech"
    if cap == "speech_to_text":
        return "audio/transcriptions"
    if cap == "video_generation":
        return "videos/generations"
    return "chat/completions"


class ProviderRegistryPlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.registry.provider",
            version="1.0.0",
            description="Manage provider protocol profiles and template verification.",
            author="Deeting Team",
        )

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "get_unified_schema",
                    "description": "Get canonical request and protocol profile contract for a capability.",
                    "parameters": {
                        "type": "object",
                        "properties": {"capability": {"type": "string"}},
                        "required": ["capability"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "verify_provider_template",
                    "description": "Render a provider request template and dry-run it against an upstream API.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "base_url": {"type": "string"},
                            "test_api_key": {"type": "string"},
                            "request_template": {"type": "object"},
                        },
                        "required": ["base_url", "test_api_key", "request_template"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "save_provider_field_mapping",
                    "description": "Persist a capability protocol profile to provider preset storage.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "provider_slug": {"type": "string"},
                            "capability": {"type": "string"},
                            "request_template": {"type": "object"},
                        },
                        "required": ["provider_slug", "capability", "request_template"],
                    },
                },
            },
        ]

    async def _require_admin(self) -> User:
        async with AsyncSessionLocal() as session:
            user = await session.get(User, self.context.user_id)
            if not user or not user.is_superuser:
                raise PermissionError("admin_required")
            return user

    async def handle_get_unified_schema(self, capability: str) -> dict[str, Any]:
        await self._require_admin()
        request_schema = CanonicalRequest.model_json_schema(mode="serialization")
        return {
            "status": "success",
            "capability": capability,
            "canonical_request_schema": request_schema,
            "protocol_profile_contract": {
                "fields": [
                    "protocol_family",
                    "transport",
                    "request.template_engine",
                    "request.request_template",
                    "request.request_builder",
                    "response.response_template",
                    "response.output_mapping",
                    "defaults.headers",
                    "defaults.body",
                ]
            },
        }

    async def handle_verify_provider_template(
        self,
        *,
        base_url: str,
        test_api_key: str,
        request_template: dict[str, Any],
        test_payload: dict[str, Any] | None = None,
        header_template: dict[str, Any] | None = None,
        template_engine: str | None = "jinja2",
        protocol_family: str | None = None,
        upstream_path: str | None = None,
        capability: str | None = "chat",
        **_: Any,
    ) -> dict[str, Any]:
        await self._require_admin()
        if not is_safe_upstream_url(base_url):
            return {"status": "error", "message": "Unsafe upstream URL"}

        env = Environment(loader=BaseLoader(), undefined=SilentUndefined)
        env.filters.setdefault(
            "tojson",
            lambda value: json.dumps(value, ensure_ascii=False),
        )
        context = {
            "input": dict(test_payload or {}),
            "request": dict(test_payload or {}),
            "api_key": test_api_key,
        }

        rendered_body = self._render_template(env, request_template or {}, context)
        rendered_headers = self._render_template(env, header_template or {}, context)

        normalized_body = self._normalize_rendered(rendered_body)
        normalized_headers = self._normalize_rendered(rendered_headers)
        if not isinstance(normalized_body, dict):
            return {"status": "error", "message": "Template Rendering Failed: body must be object"}
        if not isinstance(normalized_headers, dict):
            normalized_headers = {}

        async with create_async_http_client(timeout=10.0) as client:
            response = await client.post(
                base_url,
                json=normalized_body,
                headers={str(k): str(v) for k, v in normalized_headers.items()},
            )

        return {
            "status": "success" if getattr(response, "is_success", False) else "error",
            "status_code": getattr(response, "status_code", 0),
            "rendered_request": {
                "base_url": base_url,
                "capability": capability,
                "protocol_family": protocol_family,
                "upstream_path": upstream_path,
                "template_engine": template_engine,
                "headers": normalized_headers,
                "body": normalized_body,
            },
            "response_preview": getattr(response, "text", "")[:500],
        }

    async def handle_save_provider_field_mapping(
        self,
        *,
        provider_slug: str,
        capability: str,
        request_template: dict[str, Any],
        template_engine: str | None = "jinja2",
        protocol_family: str | None = None,
        upstream_path: str | None = None,
        response_template: dict[str, Any] | None = None,
        output_mapping: dict[str, Any] | None = None,
        request_builder: dict[str, Any] | None = None,
        default_headers: dict[str, Any] | None = None,
        default_params: dict[str, Any] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        await self._require_admin()

        async with AsyncSessionLocal() as session:
            preset = (
                await session.execute(
                    select(ProviderPreset).where(ProviderPreset.slug == provider_slug)
                )
            ).scalars().first()
            if not preset:
                return {"status": "error", "message": "provider_preset_not_found"}

            path = upstream_path or _default_upstream_path(capability)
            protocol = protocol_family or getattr(preset, "provider", "openai")
            profile = build_protocol_profile(
                provider=preset.provider,
                capability=capability,
                protocol=protocol,
                upstream_path=path,
                template_engine=template_engine or "jinja2",
                request_template=request_template,
                response_transform=response_template or {},
                output_mapping=output_mapping or {},
                request_builder=request_builder or None,
                default_headers=default_headers or {},
                default_params=default_params or {},
            )
            profiles = dict(preset.protocol_profiles or {})
            profiles[capability] = profile.model_dump(mode="python")
            preset.protocol_profiles = profiles
            await session.commit()

        upsert_provider_preset_task.delay(provider_slug)
        return {"status": "success", "provider_slug": provider_slug, "capability": capability}

    @staticmethod
    def _render_template(env: Environment, template: Any, context: dict[str, Any]) -> Any:
        if isinstance(template, str):
            if "{{" not in template and "{%" not in template:
                return template
            normalized_template = (
                template.replace(" None ", " none ")
                .replace(" True ", " true ")
                .replace(" False ", " false ")
                .replace(" is None", " is none")
                .replace(" is not None", " is not none")
                .replace(" == None", " == none")
                .replace(" != None", " != none")
            )
            return env.from_string(normalized_template).render(**context)
        if isinstance(template, dict):
            return {key: ProviderRegistryPlugin._render_template(env, value, context) for key, value in template.items()}
        if isinstance(template, list):
            return [ProviderRegistryPlugin._render_template(env, value, context) for value in template]
        return template

    @staticmethod
    def _normalize_rendered(value: Any) -> Any:
        if isinstance(value, str):
            trimmed = value.strip()
            if not trimmed:
                return value
            if trimmed in {"true", "false"}:
                return trimmed == "true"
            if trimmed in {"null", "none"}:
                return None
            if (trimmed.startswith("{") and trimmed.endswith("}")) or (
                trimmed.startswith("[") and trimmed.endswith("]")
            ):
                try:
                    return json.loads(trimmed)
                except Exception:
                    return value
            return value
        if isinstance(value, dict):
            return {key: ProviderRegistryPlugin._normalize_rendered(item) for key, item in value.items()}
        if isinstance(value, list):
            return [ProviderRegistryPlugin._normalize_rendered(item) for item in value]
        return value
