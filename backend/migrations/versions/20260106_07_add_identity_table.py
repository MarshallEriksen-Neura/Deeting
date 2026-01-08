"""add identity table for oauth bindings

Revision ID: 20260106_07
Revises: 20260106_06
Create Date: 2026-01-06
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260106_07"
down_revision = "20260106_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "identity",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, comment="创建时间"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, comment="更新时间"),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False, comment="关联的用户 ID"),
        sa.Column("provider", sa.String(length=50), nullable=False, comment="身份提供方"),
        sa.Column("external_id", sa.String(length=255), nullable=False, comment="提供方的用户唯一标识"),
        sa.Column("display_name", sa.String(length=255), nullable=True, comment="提供方展示名"),
        sa.ForeignKeyConstraint(["user_id"], ["user_account.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_identity")),
        sa.UniqueConstraint("provider", "external_id", name="uq_identity_provider_external"),
    )
    op.create_index(op.f("ix_identity_user_id"), "identity", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_identity_user_id"), table_name="identity")
    op.drop_table("identity")

