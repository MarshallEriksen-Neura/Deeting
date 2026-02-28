"""backfill missing provider_preset capability_configs (chat/embedding)

Revision ID: 20260228_01_backfill_missing_chat_embedding_capability_configs
Revises: 20260224_02_create_user_skill_installation
Create Date: 2026-02-28 08:55:00
"""

from __future__ import annotations

import copy
from typing import Any, Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260228_01_backfill_missing_chat_embedding_capability_configs"
down_revision: str | Sequence[str] | None = "20260224_02_create_user_skill_installation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

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


def _ensure_chat_embedding_configs(
    capability_configs: dict[str, Any] | None,
    provider: str | None,
) -> tuple[dict[str, Any], bool]:
    updated = dict(capability_configs or {})
    changed = False

    if "chat" not in updated:
        chat_config = copy.deepcopy(DEFAULT_CHAT_CONFIG)
        chat_config["template_engine"] = _resolve_chat_template_engine(provider)
        updated["chat"] = chat_config
        changed = True

    if "embedding" not in updated:
        updated["embedding"] = copy.deepcopy(DEFAULT_EMBEDDING_CONFIG)
        changed = True

    return updated, changed


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
        raw = row.capability_configs
        current = raw if isinstance(raw, dict) else {}
        updated, changed = _ensure_chat_embedding_configs(current, row.provider)
        if not changed:
            continue
        conn.execute(
            provider_preset.update()
            .where(provider_preset.c.id == row.id)
            .values(capability_configs=updated)
        )


def downgrade() -> None:
    # Non-destructive data migration: keep existing capability configs unchanged.
    pass
