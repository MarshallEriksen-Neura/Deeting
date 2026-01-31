"""add assistant_routing_state table

Revision ID: 20260131_03_add_assistant_routing_state
Revises: 20260131_02_add_used_persona_id
Create Date: 2026-01-31
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260131_03_add_assistant_routing_state"
down_revision: Union[str, None] = "20260131_02_add_used_persona_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assistant_routing_state",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "assistant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assistant.id", ondelete="CASCADE"),
            nullable=False,
            comment="关联的 assistant",
        ),
        sa.Column(
            "total_trials",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
            comment="总尝试次数（被选中次数）",
        ),
        sa.Column(
            "positive_feedback",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
            comment="正向反馈次数",
        ),
        sa.Column(
            "negative_feedback",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
            comment="负向反馈次数",
        ),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="最近一次被选中时间",
        ),
        sa.Column(
            "last_feedback_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="最近一次反馈时间",
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
        sa.UniqueConstraint("assistant_id", name="uq_assistant_routing_state_assistant"),
    )
    op.create_index(
        "ix_assistant_routing_state_assistant_id",
        "assistant_routing_state",
        ["assistant_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_assistant_routing_state_assistant_id",
        table_name="assistant_routing_state",
    )
    op.drop_table("assistant_routing_state")
