"""add trace feedback table and gateway_log trace_id

Revision ID: 20260204_02_add_trace_feedback
Revises: 20260204_01_bandit_scene_arm_id
Create Date: 2026-02-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260204_02_add_trace_feedback"
down_revision: str | None = "20260204_01_bandit_scene_arm_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "gateway_log",
        sa.Column(
            "trace_id",
            sa.String(length=64),
            nullable=True,
            comment="请求追踪 ID",
        ),
    )
    op.create_index("ix_gateway_log_trace_id", "gateway_log", ["trace_id"])

    op.create_table(
        "trace_feedback",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column(
            "trace_id",
            sa.String(length=64),
            nullable=False,
            comment="请求追踪 ID",
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="SET NULL"),
            nullable=True,
            comment="反馈用户 ID",
        ),
        sa.Column("score", sa.Float(), nullable=False, comment="评分（-1.0 ~ 1.0）"),
        sa.Column("comment", sa.Text(), nullable=True, comment="可选备注"),
        sa.Column("tags", sa.JSON(), nullable=True, comment="标签"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_trace_feedback_trace_id", "trace_feedback", ["trace_id"])
    op.create_index(
        "ix_trace_feedback_trace_user", "trace_feedback", ["trace_id", "user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_trace_feedback_trace_user", table_name="trace_feedback")
    op.drop_index("ix_trace_feedback_trace_id", table_name="trace_feedback")
    op.drop_table("trace_feedback")
    op.drop_index("ix_gateway_log_trace_id", table_name="gateway_log")
    op.drop_column("gateway_log", "trace_id")
