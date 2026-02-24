"""create user skill installation table

Revision ID: 20260224_02_create_user_skill_installation
Revises: 20260224_01_create_code_mode_execution
Create Date: 2026-02-24 13:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260224_02_create_user_skill_installation"
down_revision: str | Sequence[str] | None = "20260224_01_create_code_mode_execution"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _json_type():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    json_type = _json_type()
    op.create_table(
        "user_skill_installation",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("skill_id", sa.String(length=120), nullable=False),
        sa.Column("alias", sa.String(length=120), nullable=True),
        sa.Column("config_json", json_type, server_default="{}", nullable=False),
        sa.Column("granted_permissions", json_type, server_default="[]", nullable=False),
        sa.Column("installed_revision", sa.String(length=128), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["skill_id"], ["skill_registry.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user_account.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "skill_id", name="uq_user_skill_installation_user"),
    )
    op.create_index(
        "ix_user_skill_installation_user",
        "user_skill_installation",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_user_skill_installation_skill",
        "user_skill_installation",
        ["skill_id"],
        unique=False,
    )
    op.create_index(
        "ix_user_skill_installation_enabled",
        "user_skill_installation",
        ["is_enabled"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_skill_installation_enabled", table_name="user_skill_installation")
    op.drop_index("ix_user_skill_installation_skill", table_name="user_skill_installation")
    op.drop_index("ix_user_skill_installation_user", table_name="user_skill_installation")
    op.drop_table("user_skill_installation")
