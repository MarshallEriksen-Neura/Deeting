"""seed NVIDIA provider preset

Revision ID: 20260308_04_seed_nvidia_provider_preset
Revises: 20260308_03_rename_billing_transaction_provider_model_id
Create Date: 2026-03-08
"""

from __future__ import annotations

import uuid
from typing import Any, Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260308_04_seed_nvidia_provider_preset"
down_revision: str | Sequence[str] | None = (
    "20260308_03_rename_billing_transaction_provider_model_id"
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROTOCOL_SCHEMA_VERSION = "2026-03-07"
NVIDIA_PRESET_SLUG = "nvidia"


def _build_protocol_profile(
    *,
    capability: str,
    transport_path: str,
    request_template: dict[str, Any],
    decoder_name: str,
    stream_decoder_name: str | None = None,
) -> dict[str, Any]:
    profile_id = f"nvidia:{capability}:openai_chat"
    return {
        "runtime_version": "v2",
        "schema_version": PROTOCOL_SCHEMA_VERSION,
        "profile_id": profile_id,
        "version": 1,
        "provider": "nvidia",
        "protocol_family": "openai_chat",
        "capability": capability,
        "transport": {
            "method": "POST",
            "path": transport_path,
            "query_template": {},
            "header_template": {
                "Content-Type": "application/json",
            },
        },
        "request": {
            "template_engine": "openai_compat",
            "request_template": request_template,
            "request_builder": None,
        },
        "response": {
            "decoder": {
                "name": decoder_name,
                "config": {},
            },
            "response_template": {},
            "output_mapping": {},
        },
        "stream": {
            "stream_decoder": (
                {"name": stream_decoder_name, "config": {}}
                if stream_decoder_name
                else None
            ),
            "stream_options_mapping": {},
        },
        "errors": {"error_decoder": None},
        "auth": {"auth_policy": "inherit", "config": {}},
        "features": {
            "supports_messages": capability == "chat",
            "supports_input_items": False,
            "supports_tools": capability == "chat",
            "supports_reasoning": False,
            "supports_json_mode": capability == "chat",
        },
        "defaults": {
            "headers": {
                "Content-Type": "application/json",
            },
            "query": {},
            "body": {},
        },
        "metadata": {
            "docs_verified_at": "2026-03-08",
            "notes": [
                "Hosted NVIDIA Build uses Bearer NGC API key auth.",
                "Responses API remains experimental, so preset defaults to chat/completions.",
                "Image and video endpoints may require different NVIDIA domains and are not enabled here.",
            ],
        },
    }


def _build_nvidia_protocol_profiles() -> dict[str, Any]:
    return {
        "chat": _build_protocol_profile(
            capability="chat",
            transport_path="chat/completions",
            request_template={
                "model": None,
                "messages": None,
                "stream": None,
                "temperature": None,
                "top_p": None,
                "max_tokens": None,
                "tools": None,
                "tool_choice": None,
                "response_format": None,
            },
            decoder_name="openai_chat",
            stream_decoder_name="openai_chat_stream",
        ),
        "embedding": _build_protocol_profile(
            capability="embedding",
            transport_path="embeddings",
            request_template={
                "model": None,
                "input": None,
                "encoding_format": None,
                "dimensions": None,
            },
            decoder_name="openai_chat",
        ),
    }


def _build_nvidia_preset_values() -> dict[str, Any]:
    return {
        "name": "NVIDIA",
        "slug": NVIDIA_PRESET_SLUG,
        "provider": "nvidia",
        "icon": "simple-icons:nvidia",
        "theme_color": "#76B900",
        "category": "Cloud API",
        "base_url": "https://integrate.api.nvidia.com",
        "url_template": None,
        "auth_type": "bearer",
        "auth_config": {"secret_ref_id": "NGC_API_KEY"},
        "protocol_schema_version": PROTOCOL_SCHEMA_VERSION,
        "protocol_profiles": _build_nvidia_protocol_profiles(),
        "version": 1,
        "is_active": True,
    }


def upgrade() -> None:
    conn = op.get_bind()
    provider_preset = sa.table(
        "provider_preset",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.String),
        sa.column("slug", sa.String),
        sa.column("provider", sa.String),
        sa.column("icon", sa.String),
        sa.column("theme_color", sa.String),
        sa.column("category", sa.String),
        sa.column("base_url", sa.String),
        sa.column("url_template", sa.String),
        sa.column("auth_type", sa.String),
        sa.column("auth_config", postgresql.JSONB),
        sa.column("protocol_schema_version", sa.String),
        sa.column("protocol_profiles", postgresql.JSONB),
        sa.column("version", sa.Integer),
        sa.column("is_active", sa.Boolean),
    )
    preset_values = _build_nvidia_preset_values()

    existing_id = conn.execute(
        sa.select(provider_preset.c.id).where(
            provider_preset.c.slug == NVIDIA_PRESET_SLUG
        )
    ).scalar_one_or_none()

    if existing_id:
        conn.execute(
            provider_preset.update()
            .where(provider_preset.c.slug == NVIDIA_PRESET_SLUG)
            .values(**preset_values)
        )
        return

    conn.execute(
        provider_preset.insert().values(
            id=uuid.uuid4(),
            **preset_values,
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    provider_preset = sa.table(
        "provider_preset",
        sa.column("slug", sa.String),
    )
    conn.execute(
        provider_preset.delete().where(
            provider_preset.c.slug == NVIDIA_PRESET_SLUG
        )
    )
