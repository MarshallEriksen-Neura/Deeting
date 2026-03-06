"""create desktop oauth session tables

Revision ID: 20260306_01_desktop_oauth_session
Revises: 20260302_01_create_login_session
Create Date: 2026-03-06
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260306_01_desktop_oauth_session"
down_revision: str | Sequence[str] | None = "20260302_01_create_login_session"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "desktop_oauth_session",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("state", sa.String(255), nullable=False),
        sa.Column("code_verifier", sa.Text(), nullable=False),
        sa.Column("redirect_scheme", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_account.id", ondelete="SET NULL"), nullable=True),
        sa.Column("client_fingerprint", sa.String(255), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.create_index("ix_desktop_oauth_session_provider", "desktop_oauth_session", ["provider"])
    op.create_index("ix_desktop_oauth_session_state", "desktop_oauth_session", ["state"], unique=True)
    op.create_index("ix_desktop_oauth_session_status", "desktop_oauth_session", ["status"])
    op.create_index("ix_desktop_oauth_session_user_id", "desktop_oauth_session", ["user_id"])
    op.create_index("ix_desktop_oauth_session_expires_at", "desktop_oauth_session", ["expires_at"])

    op.create_table(
        "desktop_oauth_grant",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("desktop_oauth_session.id", ondelete="CASCADE"), nullable=False),
        sa.Column("grant_hash", sa.String(128), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.create_index("ix_desktop_oauth_grant_session_id", "desktop_oauth_grant", ["session_id"])
    op.create_index("ix_desktop_oauth_grant_grant_hash", "desktop_oauth_grant", ["grant_hash"], unique=True)
    op.create_index("ix_desktop_oauth_grant_status", "desktop_oauth_grant", ["status"])
    op.create_index("ix_desktop_oauth_grant_expires_at", "desktop_oauth_grant", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_desktop_oauth_grant_expires_at", table_name="desktop_oauth_grant")
    op.drop_index("ix_desktop_oauth_grant_status", table_name="desktop_oauth_grant")
    op.drop_index("ix_desktop_oauth_grant_grant_hash", table_name="desktop_oauth_grant")
    op.drop_index("ix_desktop_oauth_grant_session_id", table_name="desktop_oauth_grant")
    op.drop_table("desktop_oauth_grant")

    op.drop_index("ix_desktop_oauth_session_expires_at", table_name="desktop_oauth_session")
    op.drop_index("ix_desktop_oauth_session_user_id", table_name="desktop_oauth_session")
    op.drop_index("ix_desktop_oauth_session_status", table_name="desktop_oauth_session")
    op.drop_index("ix_desktop_oauth_session_state", table_name="desktop_oauth_session")
    op.drop_index("ix_desktop_oauth_session_provider", table_name="desktop_oauth_session")
    op.drop_table("desktop_oauth_session")
