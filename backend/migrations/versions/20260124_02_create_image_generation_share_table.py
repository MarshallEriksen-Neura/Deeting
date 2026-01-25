"""create image generation share table

Revision ID: 20260124_02_create_image_generation_share_table
Revises: 20260124_01_add_mcp_server_runtime_fields
Create Date: 2026-01-24
"""

from __future__ import annotations

from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260124_02_create_image_generation_share_table"
down_revision: Union[str, None] = "20260124_01_add_mcp_server_runtime_fields"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "image_generation_share",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("generation_task.id", ondelete="CASCADE"),
            nullable=False,
            comment="任务 ID",
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="分享用户 ID",
        ),
        sa.Column("model", sa.String(length=128), nullable=False, comment="模型标识"),
        sa.Column("prompt", sa.Text(), nullable=True, comment="提示词（公开展示）"),
        sa.Column(
            "prompt_encrypted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="提示词是否加密（公开时隐藏）",
        ),
        sa.Column("width", sa.Integer(), nullable=True, comment="输出宽度"),
        sa.Column("height", sa.Integer(), nullable=True, comment="输出高度"),
        sa.Column(
            "num_outputs",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
            comment="输出数量",
        ),
        sa.Column("steps", sa.Integer(), nullable=True, comment="推理步数"),
        sa.Column("cfg_scale", sa.Float(), nullable=True, comment="CFG 指数"),
        sa.Column("seed", sa.Integer(), nullable=True, comment="随机种子"),
        sa.Column(
            "shared_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
            comment="分享时间",
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True, comment="取消分享时间"),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
            comment="是否公开展示",
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
    op.create_index("uq_image_share_task_id", "image_generation_share", ["task_id"], unique=True)
    op.create_index("ix_image_share_user_id", "image_generation_share", ["user_id"])
    op.create_index("ix_image_share_is_active", "image_generation_share", ["is_active"])
    op.create_index("idx_image_share_shared_at", "image_generation_share", ["shared_at"])


def downgrade() -> None:
    op.drop_index("idx_image_share_shared_at", table_name="image_generation_share")
    op.drop_index("ix_image_share_is_active", table_name="image_generation_share")
    op.drop_index("ix_image_share_user_id", table_name="image_generation_share")
    op.drop_index("uq_image_share_task_id", table_name="image_generation_share")
    op.drop_table("image_generation_share")
