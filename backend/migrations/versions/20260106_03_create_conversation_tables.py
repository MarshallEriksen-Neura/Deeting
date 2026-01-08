"""create conversation session/message/summary tables

Revision ID: 20260106_03_create_conversation_tables
Revises: 20260106_02
Create Date: 2026-01-06
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260106_03_create_conversation_tables"
down_revision = "20260106_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    # 会话主表
    op.create_table(
        "conversation_session",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True, comment="租户 ID（外部通道）"),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_account.id", ondelete="SET NULL"), nullable=True, comment="用户/服务账号 ID（内部通道）"),
        sa.Column("channel", sa.String(length=20), nullable=False, server_default="internal", comment="会话通道 internal/external"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active", comment="会话状态 active/closed"),
        sa.Column("preset_id", postgresql.UUID(as_uuid=True), nullable=True, comment="最后命中的 provider preset ID（可选）"),
        sa.Column("title", sa.String(length=200), nullable=True, comment="会话标题或主题"),
        sa.Column("message_count", sa.Integer(), nullable=False, server_default="0", comment="累计消息数"),
        sa.Column("last_summary_version", sa.Integer(), nullable=False, server_default="0", comment="最近一次摘要版本"),
        sa.Column("first_message_at", sa.DateTime(timezone=True), nullable=True, comment="首条消息时间"),
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP"), comment="最近活跃时间"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_conversation_session_tenant_id", "conversation_session", ["tenant_id"])
    op.create_index("ix_conversation_session_user_id", "conversation_session", ["user_id"])
    op.create_index("ix_conversation_session_channel", "conversation_session", ["channel"])
    op.create_index("ix_conversation_session_status", "conversation_session", ["status"])
    if is_postgres:
        op.create_index(
            "ix_conversation_session_last_active",
            "conversation_session",
            ["last_active_at"],
            postgresql_using="brin",
        )
    else:
        op.create_index(
            "ix_conversation_session_last_active",
            "conversation_session",
            ["last_active_at"],
        )

    # 会话消息表
    op.create_table(
        "conversation_message",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversation_session.id", ondelete="CASCADE"), nullable=False, comment="关联会话 ID"),
        sa.Column("turn_index", sa.Integer(), nullable=False, comment="会话内顺序（从 1 开始）"),
        sa.Column("role", sa.String(length=32), nullable=False, comment="消息角色 user/assistant/system/tool"),
        sa.Column("name", sa.String(length=128), nullable=True, comment="可选：tool/function 名称"),
        sa.Column("content", sa.Text(), nullable=False, comment="消息内容"),
        sa.Column("token_estimate", sa.Integer(), nullable=False, server_default="0", comment="估算 token 数"),
        sa.Column("is_truncated", sa.Boolean(), nullable=False, server_default=sa.text("false"), comment="是否为截断内容"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("session_id", "turn_index", name="uq_conversation_message_turn"),
    )
    op.create_index("ix_conversation_message_session_id", "conversation_message", ["session_id"])
    if is_postgres:
        op.create_index(
            "ix_conversation_message_created_at",
            "conversation_message",
            ["created_at"],
            postgresql_using="brin",
        )
    else:
        op.create_index(
            "ix_conversation_message_created_at",
            "conversation_message",
            ["created_at"],
        )

    # 摘要表
    op.create_table(
        "conversation_summary",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversation_session.id", ondelete="CASCADE"), nullable=False, comment="关联会话 ID"),
        sa.Column("version", sa.Integer(), nullable=False, comment="摘要版本号"),
        sa.Column("summary_text", sa.Text(), nullable=False, comment="摘要内容"),
        sa.Column("covered_from_turn", sa.Integer(), nullable=False, comment="摘要覆盖起始 turn"),
        sa.Column("covered_to_turn", sa.Integer(), nullable=False, comment="摘要覆盖结束 turn"),
        sa.Column("start_message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversation_message.id", ondelete="SET NULL"), nullable=True, comment="覆盖的首条消息 ID"),
        sa.Column("end_message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversation_message.id", ondelete="SET NULL"), nullable=True, comment="覆盖的末条消息 ID"),
        sa.Column("token_estimate", sa.Integer(), nullable=False, server_default="0", comment="摘要估算 token 数"),
        sa.Column("summarizer_model", sa.String(length=128), nullable=True, comment="生成摘要的模型"),
        sa.Column("summarizer_preset_id", postgresql.UUID(as_uuid=True), nullable=True, comment="生成摘要的 preset ID"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("session_id", "version", name="uq_conversation_summary_version"),
    )
    op.create_index("ix_conversation_summary_session_id", "conversation_summary", ["session_id"])
    op.create_index("ix_conversation_summary_covered_to", "conversation_summary", ["covered_to_turn"])


def downgrade() -> None:
    op.drop_index("ix_conversation_summary_covered_to", table_name="conversation_summary")
    op.drop_index("ix_conversation_summary_session_id", table_name="conversation_summary")
    op.drop_table("conversation_summary")

    op.drop_index("ix_conversation_message_created_at", table_name="conversation_message")
    op.drop_index("ix_conversation_message_session_id", table_name="conversation_message")
    op.drop_table("conversation_message")

    op.drop_index("ix_conversation_session_last_active", table_name="conversation_session")
    op.drop_index("ix_conversation_session_status", table_name="conversation_session")
    op.drop_index("ix_conversation_session_channel", table_name="conversation_session")
    op.drop_index("ix_conversation_session_user_id", table_name="conversation_session")
    op.drop_index("ix_conversation_session_tenant_id", table_name="conversation_session")
    op.drop_table("conversation_session")
