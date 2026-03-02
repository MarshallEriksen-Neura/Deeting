"""create login_session table

Revision ID: 20260302_01_create_login_session
Revises: 20260301_03_add_monitor_dead_letter
Create Date: 2026-03-02
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260302_01_create_login_session"
down_revision: str | Sequence[str] | None = "20260301_03_add_monitor_dead_letter"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "login_session",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("refresh_token_jti", sa.String(64), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("device_type", sa.String(16), nullable=True),
        sa.Column("device_name", sa.String(128), nullable=True),
        sa.Column(
            "last_active_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
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
    op.create_index("ix_login_session_user_id", "login_session", ["user_id"])
    op.create_index(
        "ix_login_session_refresh_token_jti",
        "login_session",
        ["refresh_token_jti"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_login_session_refresh_token_jti", table_name="login_session")
    op.drop_index("ix_login_session_user_id", table_name="login_session")
    op.drop_table("login_session")
