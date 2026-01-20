"""backfill provider_preset capability_configs (image_generation)

Revision ID: 20260120_03_backfill_preset_capability_configs
Revises: 20260120_02_add_preset_capability_configs
Create Date: 2026-01-20 19:00:00

"""

from __future__ import annotations

import copy

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260120_03_backfill_preset_capability_configs"
down_revision = "20260120_02_add_preset_capability_configs"
branch_labels = None
depends_on = None


TEMPLATE_IMAGE = {
    "model": None,
    "prompt": None,
    "negative_prompt": None,
    "width": None,
    "height": None,
    "aspect_ratio": None,
    "num_outputs": None,
    "steps": None,
    "cfg_scale": None,
    "seed": None,
    "sampler_name": None,
    "quality": None,
    "style": None,
    "response_format": None,
    "extra_params": None,
    "provider_model_id": None,
    "session_id": None,
    "request_id": None,
    "encrypt_prompt": None,
}

DEFAULT_IMAGE_GENERATION_CONFIG = {
    "template_engine": "simple_replace",
    "request_template": TEMPLATE_IMAGE,
    "response_transform": {},
    "default_headers": {},
    "default_params": {},
    "async_config": {},
}


def upgrade() -> None:
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
        if "image_generation" in current:
            continue
        if isinstance(current.get("image"), dict):
            image_config = copy.deepcopy(current["image"])
        else:
            image_config = copy.deepcopy(DEFAULT_IMAGE_GENERATION_CONFIG)
        updated = dict(current)
        updated["image_generation"] = image_config
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
        if "image_generation" not in current:
            continue
        updated = dict(current)
        updated.pop("image_generation", None)
        conn.execute(
            provider_preset.update()
            .where(provider_preset.c.id == row.id)
            .values(capability_configs=updated)
        )
