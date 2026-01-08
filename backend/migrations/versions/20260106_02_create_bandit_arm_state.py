"""create bandit_arm_state table

Revision ID: 20260106_02
Revises: 20260106_01
Create Date: 2026-01-06
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260106_02"
down_revision = "20260106_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bandit_arm_state",
        sa.Column(
            "id",
            sa.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "preset_item_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("provider_preset_item.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("strategy", sa.String(length=32), nullable=False, server_default="epsilon_greedy"),
        sa.Column("epsilon", sa.Float(), nullable=False, server_default="0.1"),
        sa.Column("alpha", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("beta", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("total_trials", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("successes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("failures", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_latency_ms", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("latency_p95_ms", sa.Float(), nullable=True),
        sa.Column("total_cost", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("last_reward", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("cooldown_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index(
        "ix_bandit_arm_state_preset_item_id",
        "bandit_arm_state",
        ["preset_item_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_bandit_arm_state_preset_item_id", table_name="bandit_arm_state")
    op.drop_table("bandit_arm_state")
