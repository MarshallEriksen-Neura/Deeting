"""create notification tables

Revision ID: 20260115_01_create_notification_tables
Revises: 20260114_03_add_api_key_id_to_gateway_log
Create Date: 2026-01-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260115_01_create_notification_tables"
down_revision: Union[str, None] = "20260114_03_add_api_key_id_to_gateway_log"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else "postgresql"

    payload_type = postgresql.JSONB() if dialect == "postgresql" else sa.JSON()
    payload_default = sa.text("'{}'::jsonb") if dialect == "postgresql" else sa.text("'{}'")

    op.create_table(
        "notification",
        sa.Column("id", sa.UUID(), nullable=False, comment="主键 ID"),
        sa.Column("tenant_id", sa.UUID(), nullable=True, comment="租户 ID（为空表示全局）"),
        sa.Column("type", sa.String(length=40), nullable=False, server_default=sa.text("'system'"), comment="通知类型"),
        sa.Column("level", sa.String(length=20), nullable=False, server_default=sa.text("'info'"), comment="通知级别"),
        sa.Column("title", sa.String(length=200), nullable=False, comment="标题"),
        sa.Column("content", sa.Text(), nullable=False, comment="内容"),
        sa.Column("payload", payload_type, nullable=False, server_default=payload_default, comment="扩展字段（非敏感）"),
        sa.Column("source", sa.String(length=120), nullable=True, comment="来源模块/服务"),
        sa.Column("dedupe_key", sa.String(length=120), nullable=True, comment="去重键（幂等）"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True, comment="过期时间"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true"), comment="是否有效"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()"), comment="创建时间"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()"), comment="更新时间"),
        sa.PrimaryKeyConstraint("id", name="pk_notification"),
        sa.UniqueConstraint("tenant_id", "dedupe_key", name="uq_notification_tenant_dedupe"),
    )

    if dialect == "postgresql":
        op.create_index(
            "idx_notification_created_at",
            "notification",
            ["created_at"],
            postgresql_using="brin",
        )
    else:
        op.create_index(
            "idx_notification_created_at",
            "notification",
            ["created_at"],
        )
    op.create_index("ix_notification_tenant_id", "notification", ["tenant_id"])
    op.create_index("ix_notification_type", "notification", ["type"])
    op.create_index("ix_notification_level", "notification", ["level"])
    op.create_index("ix_notification_source", "notification", ["source"])
    op.create_index("ix_notification_is_active", "notification", ["is_active"])

    op.create_table(
        "notification_receipt",
        sa.Column("id", sa.UUID(), nullable=False, comment="主键 ID"),
        sa.Column(
            "notification_id",
            sa.UUID(),
            sa.ForeignKey("notification.id", ondelete="CASCADE"),
            nullable=False,
            comment="通知 ID",
        ),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
            comment="用户 ID",
        ),
        sa.Column("tenant_id", sa.UUID(), nullable=True, comment="租户 ID（冗余字段）"),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True, comment="已读时间"),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True, comment="归档时间"),
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True, comment="置顶时间"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()"), comment="创建时间"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()"), comment="更新时间"),
        sa.PrimaryKeyConstraint("id", name="pk_notification_receipt"),
        sa.UniqueConstraint("notification_id", "user_id", name="uq_notification_receipt_user"),
    )

    if dialect == "postgresql":
        op.create_index(
            "idx_notification_receipt_created_at",
            "notification_receipt",
            ["created_at"],
            postgresql_using="brin",
        )
    else:
        op.create_index(
            "idx_notification_receipt_created_at",
            "notification_receipt",
            ["created_at"],
        )
    op.create_index("ix_notification_receipt_notification_id", "notification_receipt", ["notification_id"])
    op.create_index("ix_notification_receipt_user_id", "notification_receipt", ["user_id"])
    op.create_index("ix_notification_receipt_tenant_id", "notification_receipt", ["tenant_id"])
    op.create_index("ix_notification_receipt_user_read", "notification_receipt", ["user_id", "read_at"])
    op.create_index("ix_notification_receipt_user_archived", "notification_receipt", ["user_id", "archived_at"])


def downgrade() -> None:
    op.drop_index("ix_notification_receipt_user_archived", table_name="notification_receipt")
    op.drop_index("ix_notification_receipt_user_read", table_name="notification_receipt")
    op.drop_index("ix_notification_receipt_tenant_id", table_name="notification_receipt")
    op.drop_index("ix_notification_receipt_user_id", table_name="notification_receipt")
    op.drop_index("ix_notification_receipt_notification_id", table_name="notification_receipt")
    op.drop_index("idx_notification_receipt_created_at", table_name="notification_receipt")
    op.drop_table("notification_receipt")

    op.drop_index("ix_notification_is_active", table_name="notification")
    op.drop_index("ix_notification_source", table_name="notification")
    op.drop_index("ix_notification_level", table_name="notification")
    op.drop_index("ix_notification_type", table_name="notification")
    op.drop_index("ix_notification_tenant_id", table_name="notification")
    op.drop_index("idx_notification_created_at", table_name="notification")
    op.drop_table("notification")
