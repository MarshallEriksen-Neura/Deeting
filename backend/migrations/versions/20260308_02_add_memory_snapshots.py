"""Add memory_snapshots table

Revision ID: 20260308_02_add_memory_snapshots
Revises: 20260308_01_drop_provider_preset_legacy_columns
Create Date: 2026-03-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260308_02_add_memory_snapshots"
down_revision: str | Sequence[str] | None = "20260308_01_drop_provider_preset_legacy_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "memory_snapshots",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("user_account.id", ondelete="CASCADE"), nullable=False),
        sa.Column("memory_point_id", sa.String(64), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("old_content", sa.Text, nullable=True),
        sa.Column("new_content", sa.Text, nullable=True),
        sa.Column("old_metadata", sa.JSON, nullable=True),
        sa.Column("new_metadata", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_index("ix_memory_snapshots_user_id", "memory_snapshots", ["user_id"])
    op.create_index("ix_memory_snapshots_memory_point_id", "memory_snapshots", ["memory_point_id"])


def downgrade() -> None:
    op.drop_index("ix_memory_snapshots_memory_point_id", table_name="memory_snapshots")
    op.drop_index("ix_memory_snapshots_user_id", table_name="memory_snapshots")
    op.drop_table("memory_snapshots")
