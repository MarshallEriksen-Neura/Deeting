"""fix image model capability

Revision ID: 20260119_03_fix_image_model_capability
Revises: 20260119_02_seed_image_models_openai_compat
Create Date: 2026-01-19 12:30:00
"""

from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260119_03_fix_image_model_capability"
down_revision = "20260119_02_seed_image_models_openai_compat"
branch_labels = None
depends_on = None


IMAGE_MODEL_PATTERN = re.compile(r"(dall[-_]?e|sdxl?|flux|image|img|pixart|kolors|kandinsky)", re.I)


provider_model = sa.table(
    "provider_model",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("capability", sa.String),
    sa.column("model_id", sa.String),
    sa.column("upstream_path", sa.String),
    sa.column("extra_meta", postgresql.JSONB),
)


def _upgrade_path(path: str | None) -> str | None:
    if not path:
        return path
    if "chat/completions" in path:
        return path.replace("chat/completions", "images/generations")
    return path


def _downgrade_path(path: str | None) -> str | None:
    if not path:
        return path
    if "images/generations" in path:
        return path.replace("images/generations", "chat/completions")
    return path


def _update_caps(meta: dict, from_value: str, to_value: str) -> dict:
    caps = meta.get("upstream_capabilities")
    if isinstance(caps, list):
        new_caps = [to_value if c == from_value else c for c in caps]
        if to_value not in new_caps:
            new_caps.insert(0, to_value)
        if new_caps != caps:
            meta = {**meta, "upstream_capabilities": new_caps}
        return meta
    return {**meta, "upstream_capabilities": [to_value]}


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.select(
            provider_model.c.id,
            provider_model.c.model_id,
            provider_model.c.upstream_path,
            provider_model.c.extra_meta,
        ).where(provider_model.c.capability == "vision")
    ).fetchall()

    for row in rows:
        model_id = row.model_id or ""
        if not model_id or not IMAGE_MODEL_PATTERN.search(model_id):
            continue
        updates = {"capability": "image_generation"}
        new_path = _upgrade_path(row.upstream_path)
        if new_path != row.upstream_path:
            updates["upstream_path"] = new_path
        meta = row.extra_meta if isinstance(row.extra_meta, dict) else None
        if meta is not None:
            new_meta = _update_caps(meta, "vision", "image_generation")
            if new_meta != meta:
                updates["extra_meta"] = new_meta
        conn.execute(
            provider_model.update()
            .where(provider_model.c.id == row.id)
            .values(**updates)
        )


def downgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.select(
            provider_model.c.id,
            provider_model.c.model_id,
            provider_model.c.upstream_path,
            provider_model.c.extra_meta,
        ).where(provider_model.c.capability == "image_generation")
    ).fetchall()

    for row in rows:
        model_id = row.model_id or ""
        if not model_id or not IMAGE_MODEL_PATTERN.search(model_id):
            continue
        updates = {"capability": "vision"}
        new_path = _downgrade_path(row.upstream_path)
        if new_path != row.upstream_path:
            updates["upstream_path"] = new_path
        meta = row.extra_meta if isinstance(row.extra_meta, dict) else None
        if meta is not None:
            new_meta = _update_caps(meta, "image_generation", "vision")
            if new_meta != meta:
                updates["extra_meta"] = new_meta
        conn.execute(
            provider_model.update()
            .where(provider_model.c.id == row.id)
            .values(**updates)
        )
