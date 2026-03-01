"""add monitor tables

Revision ID: 20260301_01_add_monitor_tables
Revises: 20260228_01_backfill_missing_chat_embedding_capability_configs
Create Date: 2026-03-01 00:00:00
"""

from __future__ import annotations

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260301_01_add_monitor_tables"
down_revision: str | Sequence[str] | None = "20260228_01_backfill_missing_chat_embedding_capability_configs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deeting_monitor_task",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id", sa.UUID(as_uuid=True), sa.ForeignKey("user_account.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("objective", sa.Text, nullable=False),
        sa.Column("cron_expr", sa.String(100), nullable=False, server_default="0 */6 * * *"),
        sa.Column("status", sa.String(30), nullable=False, server_default="active"),
        sa.Column("last_snapshot", postgresql.JSONB, nullable=True),
        sa.Column("last_executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_interval_minutes", sa.Integer, nullable=False, server_default="360"),
        sa.Column("strategy_variants", postgresql.JSONB, nullable=True),
        sa.Column("assistant_id", sa.UUID(as_uuid=True), sa.ForeignKey("assistant.id", ondelete="SET NULL"), nullable=True),
        sa.Column("error_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("notify_config", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("allowed_tools", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("total_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_monitor_task_user_id", "deeting_monitor_task", ["user_id"])
    op.create_index("ix_monitor_task_status", "deeting_monitor_task", ["status"])
    op.create_index("ix_monitor_task_cron_expr", "deeting_monitor_task", ["cron_expr"])
    op.create_unique_constraint("uq_monitor_task_user_title", "deeting_monitor_task", ["user_id", "title"])

    op.create_table(
        "deeting_monitor_execution_log",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "task_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("deeting_monitor_task.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("input_data", postgresql.JSONB, nullable=True),
        sa.Column("output_data", postgresql.JSONB, nullable=True),
        sa.Column("tokens_used", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_monitor_log_task_id", "deeting_monitor_execution_log", ["task_id"])
    op.create_index("ix_monitor_log_created_at", "deeting_monitor_execution_log", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_monitor_log_created_at", table_name="deeting_monitor_execution_log")
    op.drop_index("ix_monitor_log_task_id", table_name="deeting_monitor_execution_log")
    op.drop_table("deeting_monitor_execution_log")
    op.drop_constraint("uq_monitor_task_user_title", "deeting_monitor_task", type_="unique")
    op.drop_index("ix_monitor_task_cron_expr", table_name="deeting_monitor_task")
    op.drop_index("ix_monitor_task_status", table_name="deeting_monitor_task")
    op.drop_index("ix_monitor_task_user_id", table_name="deeting_monitor_task")
    op.drop_table("deeting_monitor_task")
