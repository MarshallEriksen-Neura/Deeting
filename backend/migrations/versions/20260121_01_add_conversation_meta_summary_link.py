"""add conversation meta_info and summary link

Revision ID: 20260121_01_add_conversation_meta_summary_link
Revises: 20260120_09_normalize_provider_model_capabilities
Create Date: 2026-01-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260121_01_add_conversation_meta_summary_link"
down_revision = "20260120_09_normalize_provider_model_capabilities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    meta_type = postgresql.JSONB() if is_postgres else sa.JSON()

    op.add_column(
        "conversation_message",
        sa.Column(
            "meta_info",
            meta_type,
            nullable=True,
            comment="结构化元数据：tool_calls/raw_response/attachments",
        ),
    )
    op.alter_column(
        "conversation_message",
        "content",
        existing_type=sa.Text(),
        nullable=True,
    )
    op.add_column(
        "conversation_summary",
        sa.Column(
            "previous_summary_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversation_summary.id", ondelete="SET NULL"),
            nullable=True,
            comment="前序摘要 ID（用于链式记忆）",
        ),
    )


def downgrade() -> None:
    op.drop_column("conversation_summary", "previous_summary_id")
    op.alter_column(
        "conversation_message",
        "content",
        existing_type=sa.Text(),
        nullable=False,
    )
    op.drop_column("conversation_message", "meta_info")
