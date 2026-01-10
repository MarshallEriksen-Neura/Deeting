"""
add api_key user fields (models/ip/budget/rate/logging)

Revision ID: 20260109_07_add_api_key_user_fields
Revises: 20260109_06_add_unified_model_id
Create Date: 2026-01-09 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260109_07_add_api_key_user_fields"
down_revision = "20260109_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "api_key",
        sa.Column("allowed_models", sa.JSON(), nullable=True, server_default="[]"),
    )
    op.add_column(
        "api_key",
        sa.Column("allowed_ips", sa.JSON(), nullable=True, server_default="[]"),
    )
    op.add_column(
        "api_key",
        sa.Column("budget_limit", sa.Numeric(18, 4), nullable=True),
    )
    op.add_column(
        "api_key",
        sa.Column("budget_used", sa.Numeric(18, 4), nullable=False, server_default="0"),
    )
    op.add_column(
        "api_key",
        sa.Column("rate_limit_rpm", sa.Integer(), nullable=True),
    )
    op.add_column(
        "api_key",
        sa.Column("enable_logging", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("api_key", "enable_logging")
    op.drop_column("api_key", "rate_limit_rpm")
    op.drop_column("budget_used", table_name="api_key")
    op.drop_column("budget_limit", table_name="api_key")
    op.drop_column("allowed_ips", table_name="api_key")
    op.drop_column("allowed_models", table_name="api_key")
