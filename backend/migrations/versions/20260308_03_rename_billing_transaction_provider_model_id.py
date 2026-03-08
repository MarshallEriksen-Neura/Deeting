"""rename billing transaction preset_item_id to provider_model_id

Revision ID: 20260308_03_rename_billing_transaction_provider_model_id
Revises: 20260308_02_add_memory_snapshots
Create Date: 2026-03-08
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260308_03_rename_billing_transaction_provider_model_id"
down_revision: str | Sequence[str] | None = "20260308_02_add_memory_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("billing_transaction") as batch_op:
        batch_op.alter_column(
            "preset_item_id",
            new_column_name="provider_model_id",
            existing_type=sa.UUID(),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("billing_transaction") as batch_op:
        batch_op.alter_column(
            "provider_model_id",
            new_column_name="preset_item_id",
            existing_type=sa.UUID(),
            existing_nullable=True,
        )
