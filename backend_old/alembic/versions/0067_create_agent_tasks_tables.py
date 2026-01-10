"""Create agent_tasks and ingest_records tables.

Revision ID: 0067_create_agent_tasks_tables
Revises: 0066_add_kb_global_embedding_model_to_gateway_config
Create Date: 2026-01-04
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0067_create_agent_tasks_tables"
down_revision = "0066_add_kb_global_embedding_model_to_gateway_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("task_type", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("target_url", sa.String(length=2048), nullable=True),
        sa.Column("target_file_path", sa.String(length=1024), nullable=True),
        sa.Column("provider_slug", sa.String(length=255), nullable=True),
        sa.Column("depth", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("max_pages", sa.Integer(), nullable=False, server_default=sa.text("10")),
        sa.Column("tags", sa.JSON(), nullable=True),
        sa.Column("config", sa.JSON(), nullable=True),
        sa.Column("celery_task_id", sa.String(length=255), nullable=True),
        sa.Column("worker_node", sa.String(length=255), nullable=True),
        sa.Column("result_summary", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("logs", sa.JSON(), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index("ix_agent_tasks_created_by_id", "agent_tasks", ["created_by_id"], unique=False)
    op.create_index("ix_agent_tasks_created_at", "agent_tasks", ["created_at"], unique=False)

    op.create_table(
        "ingest_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("agent_task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_tasks.id"), nullable=False),
        sa.Column("qdrant_collection", sa.String(length=255), nullable=False),
        sa.Column("qdrant_point_id", sa.String(length=255), nullable=False),
        sa.Column("chunk_hash", sa.String(length=64), nullable=True),
        sa.Column("doc_source_url", sa.String(length=2048), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index("ix_ingest_records_agent_task_id", "ingest_records", ["agent_task_id"], unique=False)
    op.create_index("ix_ingest_records_qdrant_point_id", "ingest_records", ["qdrant_point_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ingest_records_qdrant_point_id", table_name="ingest_records")
    op.drop_index("ix_ingest_records_agent_task_id", table_name="ingest_records")
    op.drop_table("ingest_records")

    op.drop_index("ix_agent_tasks_created_at", table_name="agent_tasks")
    op.drop_index("ix_agent_tasks_created_by_id", table_name="agent_tasks")
    op.drop_table("agent_tasks")
