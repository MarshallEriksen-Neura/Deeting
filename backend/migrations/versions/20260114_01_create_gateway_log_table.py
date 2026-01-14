"""create gateway_log table

Revision ID: 20260114_01_create_gateway_log_table
Revises: 20260106_08_create_assistant_tables
Create Date: 2026-01-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260114_01_create_gateway_log_table"
down_revision: Union[str, None] = "20260110_02_seed_default_providers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else "postgresql"

    op.create_table(
        "gateway_log",
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("preset_id", sa.UUID(), nullable=True),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("ttft_ms", sa.Integer(), nullable=True),
        sa.Column("upstream_url", sa.String(length=512), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_upstream", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("cost_user", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("is_cached", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
            primary_key=True,
        ),
    )
    # 索引：字段自带 index=True 的列由 SQLAlchemy 生成；这里单独创建 BRIN/时间索引以提升范围查询性能
    if dialect == "postgresql":
        op.create_index(
            "idx_gateway_log_created_at",
            "gateway_log",
            ["created_at"],
            postgresql_using="brin",
        )
    else:
        op.create_index(
            "idx_gateway_log_created_at",
            "gateway_log",
            ["created_at"],
        )
    op.create_index("ix_gateway_log_user_id", "gateway_log", ["user_id"])
    op.create_index("ix_gateway_log_preset_id", "gateway_log", ["preset_id"])
    op.create_index("ix_gateway_log_status_code", "gateway_log", ["status_code"])


def downgrade() -> None:
    op.drop_index("ix_gateway_log_status_code", table_name="gateway_log")
    op.drop_index("ix_gateway_log_preset_id", table_name="gateway_log")
    op.drop_index("ix_gateway_log_user_id", table_name="gateway_log")
    op.drop_index("idx_gateway_log_created_at", table_name="gateway_log")
    op.drop_table("gateway_log")
