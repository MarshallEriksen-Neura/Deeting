"""add used_persona_id to conversation_message

Revision ID: 20260131_02_add_used_persona_id
Revises: 20260127_02_merge_heads
Create Date: 2026-01-31
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260131_02_add_used_persona_id"
down_revision: Union[str, None] = "20260127_02_merge_heads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "conversation_message",
        sa.Column(
            "used_persona_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assistant.id", ondelete="SET NULL"),
            nullable=True,
            comment="本次消息使用的 persona/assistant ID",
        ),
    )
    op.create_index(
        "ix_conversation_message_used_persona_id",
        "conversation_message",
        ["used_persona_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_conversation_message_used_persona_id", table_name="conversation_message")
    op.drop_column("conversation_message", "used_persona_id")
