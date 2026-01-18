"""create upstream_secret store

Revision ID: 20260118_01
Revises: 20260117_06_merge_heads
Create Date: 2026-01-18
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260118_01"
down_revision = "20260117_06_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "upstream_secret",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=False, comment="provider slug/命名空间"),
        sa.Column("encrypted_secret", sa.Text(), nullable=False, comment="加密后的密钥"),
        sa.Column("secret_hint", sa.String(length=16), nullable=True, comment="密钥尾部提示"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_upstream_secret_provider", "upstream_secret", ["provider"])


def downgrade() -> None:
    op.drop_index("ix_upstream_secret_provider", table_name="upstream_secret")
    op.drop_table("upstream_secret")
