"""bind login_session to stable device tokens

Revision ID: 20260306_02_bind_login_session_to_device_tokens
Revises: 20260306_01_desktop_oauth_session
Create Date: 2026-03-06
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260306_02_bind_login_session_to_device_tokens"
down_revision: str | Sequence[str] | None = "20260306_01_desktop_oauth_session"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_login_session_refresh_token_jti", table_name="login_session")
    op.alter_column(
        "login_session",
        "refresh_token_jti",
        new_column_name="current_refresh_jti",
        existing_type=sa.String(length=64),
        existing_nullable=False,
    )
    op.add_column(
        "login_session",
        sa.Column("session_key", sa.String(length=64), nullable=False),
    )
    op.add_column(
        "login_session",
        sa.Column("current_access_jti", sa.String(length=64), nullable=False),
    )

    op.create_index(
        "ix_login_session_session_key",
        "login_session",
        ["session_key"],
        unique=True,
    )
    op.create_index(
        "ix_login_session_current_access_jti",
        "login_session",
        ["current_access_jti"],
        unique=True,
    )
    op.create_index(
        "ix_login_session_current_refresh_jti",
        "login_session",
        ["current_refresh_jti"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_login_session_current_refresh_jti", table_name="login_session")
    op.drop_index("ix_login_session_current_access_jti", table_name="login_session")
    op.drop_index("ix_login_session_session_key", table_name="login_session")

    op.drop_column("login_session", "current_access_jti")
    op.drop_column("login_session", "session_key")
    op.alter_column(
        "login_session",
        "current_refresh_jti",
        new_column_name="refresh_token_jti",
        existing_type=sa.String(length=64),
        existing_nullable=False,
    )
    op.create_index(
        "ix_login_session_refresh_token_jti",
        "login_session",
        ["refresh_token_jti"],
        unique=True,
    )
