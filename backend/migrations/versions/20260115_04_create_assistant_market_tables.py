"""create assistant market install and review tables

Revision ID: 20260115_04_create_assistant_market_tables
Revises: 20260115_03_add_assistant_icon_id
Create Date: 2026-01-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260115_04_create_assistant_market_tables"
down_revision: Union[str, None] = "20260115_03_add_assistant_icon_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assistant_install",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
            comment="所属用户 ID",
        ),
        sa.Column(
            "assistant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assistant.id", ondelete="CASCADE"),
            nullable=False,
            comment="助手 ID",
        ),
        sa.Column("alias", sa.String(length=100), nullable=True, comment="用户侧别名"),
        sa.Column("icon_override", sa.String(length=255), nullable=True, comment="用户侧图标覆盖"),
        sa.Column(
            "pinned_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assistant_version.id", ondelete="SET NULL"),
            nullable=True,
            comment="锁定版本 ID",
        ),
        sa.Column(
            "follow_latest",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
            comment="是否跟随最新版本",
        ),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
            comment="是否启用",
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="排序权重",
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
        sa.UniqueConstraint("user_id", "assistant_id", name="uq_assistant_install_user"),
    )
    op.create_index("ix_assistant_install_user", "assistant_install", ["user_id"])
    op.create_index("ix_assistant_install_assistant", "assistant_install", ["assistant_id"])

    op.create_table(
        "review_task",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False, comment="审核对象类型，如 assistant_market"),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False, comment="审核对象 ID"),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="draft",
            comment="审核状态: draft/pending/approved/rejected/suspended",
        ),
        sa.Column(
            "submitter_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="SET NULL"),
            nullable=True,
            comment="提交人用户 ID",
        ),
        sa.Column(
            "reviewer_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="SET NULL"),
            nullable=True,
            comment="审核人用户 ID",
        ),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True, comment="提交审核时间"),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True, comment="审核完成时间"),
        sa.Column("reason", sa.Text(), nullable=True, comment="审核备注/拒绝原因"),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="审核上下文扩展字段",
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
        sa.UniqueConstraint("entity_type", "entity_id", name="uq_review_task_entity"),
    )
    op.create_index("ix_review_task_entity_type", "review_task", ["entity_type"])
    op.create_index("ix_review_task_status", "review_task", ["status"])
    op.create_index("ix_review_task_entity", "review_task", ["entity_type", "entity_id"])


def downgrade() -> None:
    op.drop_index("ix_review_task_entity", table_name="review_task")
    op.drop_index("ix_review_task_status", table_name="review_task")
    op.drop_index("ix_review_task_entity_type", table_name="review_task")
    op.drop_table("review_task")

    op.drop_index("ix_assistant_install_assistant", table_name="assistant_install")
    op.drop_index("ix_assistant_install_user", table_name="assistant_install")
    op.drop_table("assistant_install")
