"""add user avatar url

Revision ID: 20260126_01_add_user_avatar_url
Revises: 20260124_04_add_mcp_sources
Create Date: 2026-01-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = "20260126_01_add_user_avatar_url"
down_revision: str | None = "20260124_04_add_mcp_sources"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("user_account")}
    if "avatar_url" in columns:
        return

    op.add_column(
        "user_account",
        sa.Column("avatar_url", sa.String(length=512), nullable=True, comment="头像 URL"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("user_account")}
    if "avatar_url" in columns:
        op.drop_column("user_account", "avatar_url")
