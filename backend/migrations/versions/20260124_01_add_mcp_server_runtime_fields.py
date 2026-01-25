"""add mcp server runtime fields

Revision ID: 20260124_01_add_mcp_server_runtime_fields
Revises: 20260121_03_rename_generation_task_table
Create Date: 2026-01-24 00:00:00.000000
"""

from __future__ import annotations

from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260124_01_add_mcp_server_runtime_fields"
down_revision: Union[str, None] = "20260121_03_rename_generation_task_table"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def _json_type(dialect_name: str):
    return postgresql.JSONB(astext_type=sa.Text()) if dialect_name == "postgresql" else sa.JSON()


def upgrade() -> None:
    bind = op.get_bind()
    dialect_name = bind.dialect.name
    inspector = sa.inspect(bind)
    json_type = _json_type(dialect_name)
    json_array_default = sa.text("'[]'::jsonb") if dialect_name == "postgresql" else "[]"

    if not inspector.has_table("user_mcp_server"):
        op.create_table(
            "user_mcp_server",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column(
                "user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("user_account.id", ondelete="CASCADE"),
                nullable=False,
                comment="Owner of this MCP configuration",
            ),
            sa.Column("name", sa.String(length=120), nullable=False, comment="Display name for this MCP server"),
            sa.Column("description", sa.Text(), nullable=True, comment="Optional description"),
            sa.Column("sse_url", sa.String(length=512), nullable=True, comment="Full URL to the MCP SSE endpoint"),
            sa.Column(
                "server_type",
                sa.String(length=20),
                nullable=False,
                server_default="sse",
                comment="Server type: sse (remote) or stdio (draft)",
            ),
            sa.Column("secret_ref_id", sa.String(length=255), nullable=True, comment="Reference to the API Key/Token in UpstreamSecret"),
            sa.Column(
                "auth_type",
                sa.String(length=40),
                nullable=False,
                server_default="bearer",
                comment="Authentication type: bearer, api_key, or none",
            ),
            sa.Column(
                "disabled_tools",
                json_type,
                nullable=False,
                server_default=json_array_default,
                comment="Tool names disabled by user",
            ),
            sa.Column(
                "draft_config",
                json_type,
                nullable=True,
                comment="Sanitized draft config for stdio imports",
            ),
            sa.Column(
                "tools_cache",
                json_type,
                nullable=False,
                server_default=json_array_default,
                comment="Snapshot of tool definitions fetched from this server",
            ),
            sa.Column(
                "is_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
                comment="Whether this MCP server is currently active in chat",
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
        op.create_index("ix_user_mcp_server_user", "user_mcp_server", ["user_id"])
        op.create_index("ix_user_mcp_server_enabled", "user_mcp_server", ["is_enabled"])

        if dialect_name == "postgresql":
            op.alter_column("user_mcp_server", "server_type", server_default=None)
            op.alter_column("user_mcp_server", "disabled_tools", server_default=None)
        return

    columns = {col["name"] for col in inspector.get_columns("user_mcp_server")}
    if "server_type" not in columns:
        op.add_column(
            "user_mcp_server",
            sa.Column("server_type", sa.String(length=20), nullable=False, server_default="sse"),
        )
    if "disabled_tools" not in columns:
        op.add_column(
            "user_mcp_server",
            sa.Column("disabled_tools", json_type, nullable=False, server_default=json_array_default),
        )
    if "draft_config" not in columns:
        op.add_column(
            "user_mcp_server",
            sa.Column("draft_config", json_type, nullable=True),
        )
    if "sse_url" in columns:
        op.alter_column("user_mcp_server", "sse_url", nullable=True)

    if dialect_name == "postgresql":
        op.alter_column("user_mcp_server", "server_type", server_default=None)
        op.alter_column("user_mcp_server", "disabled_tools", server_default=None)


def downgrade() -> None:
    op.alter_column("user_mcp_server", "sse_url", nullable=False)
    op.drop_column("user_mcp_server", "draft_config")
    op.drop_column("user_mcp_server", "disabled_tools")
    op.drop_column("user_mcp_server", "server_type")
