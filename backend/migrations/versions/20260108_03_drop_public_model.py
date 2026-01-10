"""drop public_model table (legacy)

Revision ID: 20260108_03
Revises: 20260108_02
Create Date: 2026-01-08
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260108_03"
down_revision = "20260108_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("public_model")


def downgrade() -> None:
    op.create_table(
        "public_model",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("model_id", sa.String(length=128), nullable=False, unique=True, comment="模型唯一标识"),
        sa.Column("display_name", sa.String(length=128), nullable=False, comment="展示名称"),
        sa.Column("family", sa.String(length=64), nullable=True, comment="模型家族"),
        sa.Column("type", sa.String(length=32), nullable=False, comment="模型类型"),
        sa.Column("context_window", sa.Integer(), nullable=True, comment="上下文窗口"),
        sa.Column("description", sa.Text(), nullable=True, comment="模型描述"),
        sa.Column("icon_url", sa.String(length=255), nullable=True, comment="图标 URL"),
        sa.Column("input_price_display", sa.String(length=64), nullable=True, comment="输入价格展示"),
        sa.Column("output_price_display", sa.String(length=64), nullable=True, comment="输出价格展示"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0"), comment="排序权重"),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("true"), comment="是否公开可见"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_public_model_model_id", "public_model", ["model_id"], unique=True)
