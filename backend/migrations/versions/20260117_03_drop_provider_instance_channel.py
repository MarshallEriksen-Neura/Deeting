"""drop provider_instance channel

Revision ID: 20260117_03_drop_provider_instance_channel
Revises: 20260117_02_seed_default_assistant
Create Date: 2026-01-17 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260117_03_drop_provider_instance_channel"
down_revision = "20260117_02_seed_default_assistant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("provider_instance", "channel")


def downgrade() -> None:
    op.add_column(
        "provider_instance",
        sa.Column(
            "channel",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'external'"),
        ),
    )
