"""add tsvector and indexes for assistant search

Revision ID: 20260106_09_add_assistant_search_index
Revises: 20260106_08
Create Date: 2026-01-06
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260106_09_add_assistant_search_index"
down_revision = "20260106_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    # 仅 Postgres 才添加生成列与 GIN 索引
    if is_postgres:
        op.add_column(
            "assistant_version",
            sa.Column(
                "tsv",
                postgresql.TSVECTOR(),
                sa.Computed(
                    "to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(system_prompt,''))",
                    persisted=True,
                ),
                nullable=False,
            ),
        )
        op.create_index(
            "ix_assistant_version_tsv",
            "assistant_version",
            ["tsv"],
            postgresql_using="gin",
        )
        # tags (jsonb array) gin 索引
        op.create_index(
            "ix_assistant_version_tags",
            "assistant_version",
            ["tags"],
            postgresql_using="gin",
        )
    else:
        # 非 Postgres 环境保留兼容性：添加可空列但不生成索引
        op.add_column(
            "assistant_version",
            sa.Column("tsv", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.drop_index("ix_assistant_version_tags", table_name="assistant_version")
        op.drop_index("ix_assistant_version_tsv", table_name="assistant_version")
    op.drop_column("assistant_version", "tsv")
