"""create assistant tables

Revision ID: 20260106_08
Revises: 20260106_07
Create Date: 2026-01-06
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260106_08"
down_revision = "20260106_07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "owner_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="SET NULL"),
            nullable=True,
            comment="拥有者用户 ID",
        ),
        sa.Column(
            "visibility",
            sa.String(length=20),
            nullable=False,
            server_default="private",
            comment="可见性: private/unlisted/public",
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="draft",
            comment="发布状态: draft/published/archived",
        ),
        sa.Column(
            "share_slug",
            sa.String(length=64),
            nullable=True,
            comment="分享访问标识（unlisted/public 使用）",
        ),
        sa.Column(
            "current_version_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment="当前激活版本 ID",
        ),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="发布时间",
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
        sa.UniqueConstraint("share_slug", name="uq_assistant_share_slug"),
    )
    op.create_index("ix_assistant_owner", "assistant", ["owner_user_id"])
    op.create_index("ix_assistant_visibility_status", "assistant", ["visibility", "status"])
    op.create_index("ix_assistant_published_at", "assistant", ["published_at"])

    op.create_table(
        "assistant_version",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "assistant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assistant.id", ondelete="CASCADE"),
            nullable=False,
            comment="所属助手 ID",
        ),
        sa.Column("version", sa.String(length=32), nullable=False, comment="语义化版本号，例如 0.1.0"),
        sa.Column("name", sa.String(length=100), nullable=False, comment="版本名称/展示名"),
        sa.Column("description", sa.Text(), nullable=True, comment="描述/用途说明"),
        sa.Column("system_prompt", sa.Text(), nullable=False, comment="系统提示词内容"),
        sa.Column(
            "model_config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="模型与参数配置",
        ),
        sa.Column(
            "skill_refs",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
            comment="依赖的技能列表，元素含 skill_id/version 等",
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
            comment="标签列表",
        ),
        sa.Column("changelog", sa.Text(), nullable=True, comment="版本变更说明"),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="该版本发布时间（与主表状态一致时填写）",
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
        sa.UniqueConstraint("assistant_id", "version", name="uq_assistant_version_semver"),
    )
    op.create_index("ix_assistant_version_assistant", "assistant_version", ["assistant_id"])

    op.create_foreign_key(
        "fk_assistant_current_version",
        "assistant",
        "assistant_version",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_assistant_current_version", "assistant", type_="foreignkey")
    op.drop_index("ix_assistant_version_assistant", table_name="assistant_version")
    op.drop_table("assistant_version")

    op.drop_index("ix_assistant_published_at", table_name="assistant")
    op.drop_index("ix_assistant_visibility_status", table_name="assistant")
    op.drop_index("ix_assistant_owner", table_name="assistant")
    op.drop_table("assistant")
