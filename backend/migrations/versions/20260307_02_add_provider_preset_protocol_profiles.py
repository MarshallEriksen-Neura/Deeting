"""add provider preset protocol profiles

Revision ID: 20260307_02_add_provider_preset_protocol_profiles
Revises: 20260307_01_create_alipay_recharge_order
Create Date: 2026-03-07
"""

from __future__ import annotations

import json
from typing import Any, Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260307_02_add_provider_preset_protocol_profiles"
down_revision: str | Sequence[str] | None = "20260307_01_create_alipay_recharge_order"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROTOCOL_SCHEMA_VERSION = "2026-03-07"


def _infer_protocol_family(provider: str, capability: str, request_template: dict[str, Any]) -> str:
    provider_lower = (provider or "").strip().lower()
    keys = {str(key) for key in (request_template or {}).keys()}
    if "anthropic" in provider_lower or "claude" in provider_lower:
        return "anthropic_messages"
    if capability == "chat" and "input" in keys and "messages" not in keys:
        return "openai_responses"
    return "openai_chat"


def _default_transport_path(capability: str, protocol_family: str) -> str:
    if capability == "embedding":
        return "embeddings"
    if capability == "image_generation":
        return "images/generations"
    if capability == "text_to_speech":
        return "audio/speech"
    if capability == "speech_to_text":
        return "audio/transcriptions"
    if capability == "video_generation":
        return "videos/generations"
    if protocol_family == "openai_responses":
        return "responses"
    if protocol_family == "anthropic_messages":
        return "v1/messages"
    return "chat/completions"


def _default_decoder(protocol_family: str) -> str:
    if protocol_family == "openai_responses":
        return "openai_responses"
    if protocol_family == "anthropic_messages":
        return "anthropic_messages"
    return "openai_chat"


def _default_stream_decoder(protocol_family: str) -> str:
    if protocol_family == "openai_responses":
        return "openai_responses_stream"
    if protocol_family == "anthropic_messages":
        return "anthropic_messages_stream"
    return "openai_chat_stream"


def upgrade() -> None:
    op.add_column(
        "provider_preset",
        sa.Column("protocol_schema_version", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "provider_preset",
        sa.Column(
            "protocol_profiles",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT slug, provider, default_headers, default_params, capability_configs "
            "FROM provider_preset"
        )
    ).mappings()

    for row in rows:
        provider = row["provider"] or "custom"
        default_headers = row["default_headers"] or {}
        default_params = row["default_params"] or {}
        capability_configs = row["capability_configs"] or {}
        if isinstance(default_headers, str):
            default_headers = json.loads(default_headers or "{}")
        if isinstance(default_params, str):
            default_params = json.loads(default_params or "{}")
        if isinstance(capability_configs, str):
            capability_configs = json.loads(capability_configs or "{}")

        protocol_profiles: dict[str, Any] = {}
        if isinstance(capability_configs, dict):
            for capability, config in capability_configs.items():
                if not isinstance(config, dict):
                    continue
                request_template = (
                    config.get("request_template")
                    or config.get("body_template")
                    or {}
                )
                if not isinstance(request_template, dict):
                    request_template = {}
                protocol_family = _infer_protocol_family(provider, capability, request_template)
                protocol_profiles[str(capability)] = {
                    "runtime_version": "v2",
                    "schema_version": PROTOCOL_SCHEMA_VERSION,
                    "profile_id": f"{provider}:{capability}:{protocol_family}",
                    "provider": provider,
                    "protocol_family": protocol_family,
                    "capability": capability,
                    "transport": {
                        "method": config.get("http_method") or config.get("method") or "POST",
                        "path": _default_transport_path(str(capability), protocol_family),
                        "query_template": {},
                        "header_template": {
                            **(default_headers if isinstance(default_headers, dict) else {}),
                            **(
                                (config.get("default_headers") or config.get("headers") or {})
                                if isinstance(config.get("default_headers") or config.get("headers") or {}, dict)
                                else {}
                            ),
                        },
                    },
                    "request": {
                        "template_engine": config.get("template_engine") or "openai_compat",
                        "request_template": request_template,
                        "request_builder": (
                            config.get("request_builder")
                            if isinstance(config.get("request_builder"), dict)
                            else None
                        ),
                    },
                    "response": {
                        "decoder": {"name": _default_decoder(protocol_family), "config": {}},
                        "response_template": (
                            config.get("response_transform")
                            if isinstance(config.get("response_transform"), dict)
                            else {}
                        ),
                    },
                    "stream": {
                        "stream_decoder": {
                            "name": _default_stream_decoder(protocol_family),
                            "config": {},
                        }
                    },
                    "auth": {"auth_policy": "inherit", "config": {}},
                    "features": {
                        "supports_messages": protocol_family != "openai_responses",
                        "supports_input_items": protocol_family == "openai_responses",
                        "supports_tools": True,
                        "supports_reasoning": protocol_family in {"openai_responses", "anthropic_messages"},
                        "supports_json_mode": protocol_family != "anthropic_messages",
                    },
                    "defaults": {
                        "headers": {
                            **(default_headers if isinstance(default_headers, dict) else {}),
                        },
                        "query": {},
                        "body": {
                            **(default_params if isinstance(default_params, dict) else {}),
                            **(
                                (config.get("default_params") or config.get("params") or {})
                                if isinstance(config.get("default_params") or config.get("params") or {}, dict)
                                else {}
                            ),
                        },
                    },
                    "metadata": {
                        "migrated_from": "capability_configs",
                        "preset_slug": row["slug"],
                    },
                }

        bind.execute(
            sa.text(
                "UPDATE provider_preset "
                "SET protocol_schema_version = :version, protocol_profiles = :profiles "
                "WHERE slug = :slug"
            ),
            {
                "slug": row["slug"],
                "version": PROTOCOL_SCHEMA_VERSION,
                "profiles": json.dumps(protocol_profiles, ensure_ascii=False),
            },
        )


def downgrade() -> None:
    op.drop_column("provider_preset", "protocol_profiles")
    op.drop_column("provider_preset", "protocol_schema_version")
