"""add monitor dead letter table

Revision ID: 20260301_03_add_monitor_dead_letter
Revises: 941682ac4a78
Create Date: 2026-03-01 12:00:00
"""

from __future__ import annotations

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260301_03_add_monitor_dead_letter"
down_revision: str | Sequence[str] | None = "941682ac4a78"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deeting_monitor_dead_letter",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "task_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("deeting_monitor_task.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("worker", sa.String(64), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payload", postgresql.JSONB, nullable=True),
        sa.Column("error_message", sa.Text(), nullable=False),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_monitor_dlq_task_id", "deeting_monitor_dead_letter", ["task_id"])
    op.create_index("ix_monitor_dlq_worker", "deeting_monitor_dead_letter", ["worker"])
    op.create_index("ix_monitor_dlq_created_at", "deeting_monitor_dead_letter", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_monitor_dlq_created_at", table_name="deeting_monitor_dead_letter")
    op.drop_index("ix_monitor_dlq_worker", table_name="deeting_monitor_dead_letter")
    op.drop_index("ix_monitor_dlq_task_id", table_name="deeting_monitor_dead_letter")
    op.drop_table("deeting_monitor_dead_letter")
