"""add soft delete fields for conversation_message

Revision ID: 20260114_02_add_conversation_delete_fields
Revises: 20260114_01_create_gateway_log_table
Create Date: 2026-01-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260114_02_add_conversation_delete_fields"
down_revision: Union[str, None] = "20260114_01_create_gateway_log_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "conversation_message",
        sa.Column(
            "is_deleted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="是否被用户删除（软删除）",
        ),
    )
    op.add_column(
        "conversation_message",
        sa.Column(
            "parent_message_id",
            sa.UUID(),
            sa.ForeignKey("conversation_message.id", ondelete="SET NULL"),
            nullable=True,
            comment="源消息 ID（用于重新生成/引用）",
        ),
    )
    op.create_index(
        "ix_conversation_message_is_deleted",
        "conversation_message",
        ["is_deleted"],
    )


def downgrade() -> None:
    op.drop_index("ix_conversation_message_is_deleted", table_name="conversation_message")
    op.drop_column("conversation_message", "parent_message_id")
    op.drop_column("conversation_message", "is_deleted")
