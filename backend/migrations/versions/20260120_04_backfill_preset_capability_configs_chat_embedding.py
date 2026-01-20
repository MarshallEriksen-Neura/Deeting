"""backfill provider_preset capability_configs (chat/embedding)

Revision ID: 20260120_04_backfill_preset_capability_configs_chat_embedding
Revises: 20260120_03_backfill_preset_capability_configs
Create Date: 2026-01-20 20:10:00

"""

from __future__ import annotations

import copy

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260120_04_backfill_preset_capability_configs_chat_embedding"
down_revision = "20260120_03_backfill_preset_capability_configs"
branch_labels = None
depends_on = None


TEMPLATE_CHAT = {
    "model": None,
    "messages": None,
    "stream": None,
    "status_stream": None,
    "temperature": None,
    "max_tokens": None,
    "provider_model_id": None,
    "assistant_id": None,
    "session_id": None,
}

TEMPLATE_EMBEDDING = {
    "model": None,
    "input": None,
    "provider_model_id": None,
}

DEFAULT_CHAT_CONFIG = {
    "template_engine": "simple_replace",
    "request_template": TEMPLATE_CHAT,
    "response_transform": {},
    "default_headers": {},
    "default_params": {},
    "async_config": {},
}

DEFAULT_EMBEDDING_CONFIG = {
    "template_engine": "simple_replace",
    "request_template": TEMPLATE_EMBEDDING,
    "response_transform": {},
    "default_headers": {},
    "default_params": {},
    "async_config": {},
}


def _resolve_chat_template_engine(provider: str | None) -> str:
    provider = (provider or "").lower()
    if "anthropic" in provider or "claude" in provider:
        return "anthropic_messages"
    if "gemini" in provider or "google" in provider or "vertex" in provider:
        return "google_gemini"
    return "openai_compat"


def upgrade() -> None:
    conn = op.get_bind()

    provider_preset = sa.table(
        "provider_preset",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("provider", sa.String()),
        sa.column("capability_configs", postgresql.JSONB(astext_type=sa.Text())),
    )

    rows = conn.execute(
        sa.select(
            provider_preset.c.id,
            provider_preset.c.provider,
            provider_preset.c.capability_configs,
        )
    ).fetchall()

    for row in rows:
        current = row.capability_configs or {}
        updated = dict(current)
        changed = False

        if "chat" not in updated:
            chat_config = copy.deepcopy(DEFAULT_CHAT_CONFIG)
            chat_config["template_engine"] = _resolve_chat_template_engine(
                row.provider
            )
            updated["chat"] = chat_config
            changed = True
        if "embedding" not in updated:
            updated["embedding"] = copy.deepcopy(DEFAULT_EMBEDDING_CONFIG)
            changed = True

        if changed:
            conn.execute(
                provider_preset.update()
                .where(provider_preset.c.id == row.id)
                .values(capability_configs=updated)
            )


def downgrade() -> None:
    conn = op.get_bind()

    provider_preset = sa.table(
        "provider_preset",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("capability_configs", postgresql.JSONB(astext_type=sa.Text())),
    )

    rows = conn.execute(
        sa.select(provider_preset.c.id, provider_preset.c.capability_configs)
    ).fetchall()

    for row in rows:
        current = row.capability_configs or {}
        if "chat" not in current and "embedding" not in current:
            continue
        updated = dict(current)
        updated.pop("chat", None)
        updated.pop("embedding", None)
        conn.execute(
            provider_preset.update()
            .where(provider_preset.c.id == row.id)
            .values(capability_configs=updated)
        )
