"""create_code_mode_execution_table

Revision ID: 20260224_01_create_code_mode_execution
Revises: seed_web_scout_assistant
Create Date: 2026-02-24 12:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260224_01_create_code_mode_execution"
down_revision: str | Sequence[str] | None = "seed_web_scout_assistant"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _json_type():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    json_type = _json_type()
    op.create_table(
        "code_mode_execution",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.String(length=255), nullable=False),
        sa.Column("execution_id", sa.String(length=64), nullable=False),
        sa.Column("trace_id", sa.String(length=64), nullable=True),
        sa.Column("language", sa.String(length=32), server_default="python", nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("format_version", sa.String(length=64), nullable=True),
        sa.Column("runtime_protocol_version", sa.String(length=32), nullable=True),
        sa.Column("runtime_context", json_type, server_default="{}", nullable=False),
        sa.Column("tool_plan_results", json_type, server_default="{}", nullable=False),
        sa.Column("runtime_tool_calls", json_type, server_default="{}", nullable=False),
        sa.Column("render_blocks", json_type, server_default="{}", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("duration_ms", sa.Integer(), server_default="0", nullable=False),
        sa.Column("request_meta", json_type, server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user_account.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_code_mode_execution_created_at", "code_mode_execution", ["created_at"], unique=False)
    op.create_index("ix_code_mode_execution_execution_id", "code_mode_execution", ["execution_id"], unique=False)
    op.create_index("ix_code_mode_execution_session_id", "code_mode_execution", ["session_id"], unique=False)
    op.create_index("ix_code_mode_execution_status", "code_mode_execution", ["status"], unique=False)
    op.create_index("ix_code_mode_execution_trace_id", "code_mode_execution", ["trace_id"], unique=False)
    op.create_index("ix_code_mode_execution_user_created", "code_mode_execution", ["user_id", "created_at"], unique=False)
    op.create_index("ix_code_mode_execution_user_id", "code_mode_execution", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_code_mode_execution_user_id", table_name="code_mode_execution")
    op.drop_index("ix_code_mode_execution_user_created", table_name="code_mode_execution")
    op.drop_index("ix_code_mode_execution_trace_id", table_name="code_mode_execution")
    op.drop_index("ix_code_mode_execution_status", table_name="code_mode_execution")
    op.drop_index("ix_code_mode_execution_session_id", table_name="code_mode_execution")
    op.drop_index("ix_code_mode_execution_execution_id", table_name="code_mode_execution")
    op.drop_index("ix_code_mode_execution_created_at", table_name="code_mode_execution")
    op.drop_table("code_mode_execution")
