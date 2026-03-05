"""add is_public to provider_instance

Revision ID: 20260305_01_add_provider_instance_is_public
Revises: 20260302_01_create_login_session
Create Date: 2026-03-05
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260305_01_add_provider_instance_is_public"
down_revision: str | Sequence[str] | None = "20260302_01_create_login_session"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "provider_instance",
        sa.Column(
            "is_public",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="是否公开给普通用户可见/可路由",
        ),
    )
    op.create_index(
        "ix_provider_instance_is_public",
        "provider_instance",
        ["is_public"],
        unique=False,
    )
    # 兼容历史数据：过去 user_id 为空即公共实例
    op.execute(
        "UPDATE provider_instance SET is_public = true WHERE user_id IS NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_provider_instance_is_public", table_name="provider_instance")
    op.drop_column("provider_instance", "is_public")
