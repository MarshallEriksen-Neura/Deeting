"""add conversation_session_id to spec_plan

Revision ID: 20260126_02_add_spec_plan_conversation_session
Revises: 20260126_01_create_spec_agent_tables
Create Date: 2026-01-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260126_02_add_spec_plan_conversation_session"
down_revision: Union[str, None] = "20260126_01_create_spec_agent_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "spec_plan",
        sa.Column(
            "conversation_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversation_session.id", ondelete="SET NULL"),
            nullable=True,
            comment="关联会话 ID",
        ),
    )
    op.create_index(
        "ix_spec_plan_conversation_session",
        "spec_plan",
        ["conversation_session_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_spec_plan_conversation_session", table_name="spec_plan")
    op.drop_column("spec_plan", "conversation_session_id")
