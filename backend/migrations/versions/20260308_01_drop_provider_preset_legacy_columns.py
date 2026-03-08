"""drop provider preset legacy columns

Revision ID: 20260308_01_drop_provider_preset_legacy_columns
Revises: 20260307_02_add_provider_preset_protocol_profiles
Create Date: 2026-03-08
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260308_01_drop_provider_preset_legacy_columns"
down_revision: str | Sequence[str] | None = "20260307_02_add_provider_preset_protocol_profiles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("provider_preset") as batch_op:
        batch_op.drop_column("template_engine")
        batch_op.drop_column("response_transform")
        batch_op.drop_column("default_headers")
        batch_op.drop_column("default_params")
        batch_op.drop_column("capability_configs")


def downgrade() -> None:
    with op.batch_alter_table("provider_preset") as batch_op:
        batch_op.add_column(
            sa.Column("capability_configs", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )
        batch_op.add_column(
            sa.Column("default_params", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )
        batch_op.add_column(
            sa.Column("default_headers", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )
        batch_op.add_column(
            sa.Column("response_transform", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )
        batch_op.add_column(
            sa.Column("template_engine", sa.String(length=255), nullable=True)
        )
