"""add unified_model_id to provider_model

Revision ID: 20260109_06
Revises: 20260109_05
Create Date: 2026-01-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260109_06"
down_revision = "20260109_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "provider_model",
        sa.Column("unified_model_id", sa.String(length=128), nullable=True),
    )
    # 简单列索引
    op.create_index(
        "ix_provider_model_unified_model_id",
        "provider_model",
        ["unified_model_id"],
        unique=False,
    )
    # 部分唯一索引：同一实例/能力下 unified_model_id 不能重复（允许 NULL）
    op.create_index(
        "uq_provider_model_unified",
        "provider_model",
        ["instance_id", "capability", "unified_model_id"],
        unique=True,
        postgresql_where=sa.text("unified_model_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_provider_model_unified", table_name="provider_model")
    op.drop_index("ix_provider_model_unified_model_id", table_name="provider_model")
    op.drop_column("provider_model", "unified_model_id")
