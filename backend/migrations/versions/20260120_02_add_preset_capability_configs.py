"""add capability_configs to provider_preset and config_override to provider_model

Revision ID: 20260120_02_add_preset_capability_configs
Revises: 20260120_01_backfill_provider_model_templates
Create Date: 2026-01-20 12:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260120_02_add_preset_capability_configs"
down_revision = "20260120_01_backfill_provider_model_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "provider_preset",
        sa.Column(
            "capability_configs",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="按能力配置的模板/路由/异步策略",
        ),
    )
    op.add_column(
        "provider_model",
        sa.Column(
            "config_override",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="能力配置覆盖（Merge Patch）",
        ),
    )


def downgrade() -> None:
    op.drop_column("provider_model", "config_override")
    op.drop_column("provider_preset", "capability_configs")
