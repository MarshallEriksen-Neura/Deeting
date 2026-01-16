"""add assistant_id to conversation_session

Revision ID: 20260116_02_add_conversation_session_assistant_id
Revises: 20260116_01_create_mcp_market_tables
Create Date: 2026-01-16
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260116_02_add_conversation_session_assistant_id"
down_revision: Union[str, None] = "20260116_01_create_mcp_market_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "conversation_session",
        sa.Column(
            "assistant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assistant.id", ondelete="SET NULL"),
            nullable=True,
            comment="助手 ID（内部通道）",
        ),
    )
    op.create_index(
        "ix_conversation_session_assistant_id",
        "conversation_session",
        ["assistant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_conversation_session_assistant_id", table_name="conversation_session")
    op.drop_column("conversation_session", "assistant_id")
