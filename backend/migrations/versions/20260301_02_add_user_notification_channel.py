"""add user notification channel table

Revision ID: 20260301_02_add_user_notification_channel
Revises: 20260301_01_add_monitor_tables
Create Date: 2026-03-01 01:00:00
"""

from __future__ import annotations

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260301_02_add_user_notification_channel"
down_revision: str | Sequence[str] | None = "20260301_01_add_monitor_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_notification_channel",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id", sa.UUID(as_uuid=True), sa.ForeignKey("user_account.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=True),
        sa.Column("config", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("priority", sa.Integer, nullable=False, server_default="100"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_user_notification_channel_user_id", "user_notification_channel", ["user_id"])
    op.create_index("ix_user_notification_channel_priority", "user_notification_channel", ["user_id", "priority"])
    op.create_unique_constraint("uq_user_notification_channel", "user_notification_channel", ["user_id", "channel"])


def downgrade() -> None:
    op.drop_constraint("uq_user_notification_channel", "user_notification_channel", type_="unique")
    op.drop_index("ix_user_notification_channel_priority", table_name="user_notification_channel")
    op.drop_index("ix_user_notification_channel_user_id", table_name="user_notification_channel")
    op.drop_table("user_notification_channel")
