"""create mcp market tool and subscription tables

Revision ID: 20260116_01_create_mcp_market_tables
Revises: 20260115_07_add_user_secretary_model
Create Date: 2026-01-16
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260116_01_create_mcp_market_tables"
down_revision: Union[str, None] = "20260115_07_add_user_secretary_model"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mcp_market_tool",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("identifier", sa.String(length=120), nullable=False, comment="人类可读标识 (e.g. mcp/github)"),
        sa.Column("name", sa.String(length=200), nullable=False, comment="展示名称"),
        sa.Column("description", sa.Text(), nullable=False, comment="工具简介"),
        sa.Column("avatar_url", sa.String(length=512), nullable=True, comment="展示头像 URL"),
        sa.Column(
            "category",
            sa.String(length=40),
            nullable=False,
            server_default="other",
            comment="分类",
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
            comment="标签",
        ),
        sa.Column(
            "author",
            sa.String(length=120),
            nullable=False,
            server_default="Deeting Official",
            comment="作者",
        ),
        sa.Column(
            "is_official",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="是否官方来源",
        ),
        sa.Column(
            "download_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="下载量",
        ),
        sa.Column(
            "install_manifest",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="安装清单 (runtime/command/args/env_config)",
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
        sa.UniqueConstraint("identifier", name="uq_mcp_market_tool_identifier"),
    )
    op.create_index("ix_mcp_market_tool_identifier", "mcp_market_tool", ["identifier"])
    op.create_index("ix_mcp_market_tool_category", "mcp_market_tool", ["category"])
    op.create_index("ix_mcp_market_tool_official", "mcp_market_tool", ["is_official"])

    op.create_table(
        "user_mcp_subscription",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
            comment="所属用户 ID",
        ),
        sa.Column(
            "market_tool_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("mcp_market_tool.id", ondelete="CASCADE"),
            nullable=False,
            comment="市场工具 ID",
        ),
        sa.Column("alias", sa.String(length=100), nullable=True, comment="用户侧别名"),
        sa.Column("config_hash_snapshot", sa.String(length=128), nullable=True, comment="订阅时的配置快照 Hash"),
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
        sa.UniqueConstraint("user_id", "market_tool_id", name="uq_user_mcp_subscription_user_tool"),
    )
    op.create_index("ix_user_mcp_subscription_user", "user_mcp_subscription", ["user_id"])
    op.create_index("ix_user_mcp_subscription_tool", "user_mcp_subscription", ["market_tool_id"])


def downgrade() -> None:
    op.drop_index("ix_user_mcp_subscription_tool", table_name="user_mcp_subscription")
    op.drop_index("ix_user_mcp_subscription_user", table_name="user_mcp_subscription")
    op.drop_table("user_mcp_subscription")

    op.drop_index("ix_mcp_market_tool_official", table_name="mcp_market_tool")
    op.drop_index("ix_mcp_market_tool_category", table_name="mcp_market_tool")
    op.drop_index("ix_mcp_market_tool_identifier", table_name="mcp_market_tool")
    op.drop_table("mcp_market_tool")
