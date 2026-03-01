"""add model_id to monitor task

Revision ID: 941682ac4a78
Revises: 20260301_02_add_user_notification_channel
Create Date: 2026-03-01 09:49:58.459451
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '941682ac4a78'
down_revision = '20260301_02_add_user_notification_channel'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("deeting_monitor_task")}
    if "model_id" not in columns:
        op.add_column(
            "deeting_monitor_task",
            sa.Column("model_id", sa.String(length=100), nullable=True),
        )
    indexes = {idx["name"] for idx in inspector.get_indexes("deeting_monitor_task")}
    if "ix_monitor_task_next_run_at" not in indexes:
        op.create_index(
            "ix_monitor_task_next_run_at",
            "deeting_monitor_task",
            ["next_run_at"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {idx["name"] for idx in inspector.get_indexes("deeting_monitor_task")}
    if "ix_monitor_task_next_run_at" in indexes:
        op.drop_index("ix_monitor_task_next_run_at", table_name="deeting_monitor_task")
    columns = {col["name"] for col in inspector.get_columns("deeting_monitor_task")}
    if "model_id" in columns:
        op.drop_column("deeting_monitor_task", "model_id")
