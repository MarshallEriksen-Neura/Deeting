"""add mcp sources and link servers

Revision ID: 20260124_04_add_mcp_sources
Revises: 20260124_03_create_image_generation_share_tag_link
Create Date: 2026-01-24
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260124_04_add_mcp_sources"
down_revision: str | None = "20260124_03_create_image_generation_share_tag_link"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect_name = bind.dialect.name
    inspector = sa.inspect(bind)

    if not inspector.has_table("user_mcp_source"):
        op.create_table(
            "user_mcp_source",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column(
                "user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("user_account.id", ondelete="CASCADE"),
                nullable=False,
                comment="Owner of this MCP source",
            ),
            sa.Column("name", sa.String(length=120), nullable=False, comment="Display name for this MCP source"),
            sa.Column(
                "source_type",
                sa.String(length=40),
                nullable=False,
                server_default="url",
                comment="Source type: modelscope, github, url, cloud, local",
            ),
            sa.Column("path_or_url", sa.String(length=512), nullable=False, comment="Source URL or path"),
            sa.Column(
                "trust_level",
                sa.String(length=40),
                nullable=False,
                server_default="community",
                comment="Trust level: official, community, private",
            ),
            sa.Column(
                "status",
                sa.String(length=20),
                nullable=False,
                server_default="active",
                comment="Sync status: active, inactive, syncing, error",
            ),
            sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "is_read_only",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
                comment="Whether this source is read-only",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
        )
        op.create_index("ix_user_mcp_source_user", "user_mcp_source", ["user_id"])

    columns = {col["name"] for col in inspector.get_columns("user_mcp_server")}
    if "source_id" not in columns:
        op.add_column(
            "user_mcp_server",
            sa.Column(
                "source_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("user_mcp_source.id", ondelete="CASCADE"),
                nullable=True,
            ),
        )
        op.create_index("ix_user_mcp_server_source", "user_mcp_server", ["source_id"])
    if "source_key" not in columns:
        op.add_column(
            "user_mcp_server",
            sa.Column("source_key", sa.String(length=255), nullable=True),
        )

    if dialect_name == "postgresql":
        op.alter_column("user_mcp_source", "source_type", server_default=None)
        op.alter_column("user_mcp_source", "trust_level", server_default=None)
        op.alter_column("user_mcp_source", "status", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_user_mcp_server_source", table_name="user_mcp_server")
    op.drop_column("user_mcp_server", "source_key")
    op.drop_column("user_mcp_server", "source_id")
    op.drop_index("ix_user_mcp_source_user", table_name="user_mcp_source")
    op.drop_table("user_mcp_source")
