"""add scene and arm_id to bandit_arm_state

Revision ID: 20260204_01_bandit_scene_arm_id
Revises: 20260201_02_expand_skill_registry
Create Date: 2026-02-04 00:00:00.000000
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260204_01_bandit_scene_arm_id"
down_revision: Union[str, None] = "20260201_02_expand_skill_registry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("bandit_arm_state", "provider_model_id", nullable=True)
    op.add_column(
        "bandit_arm_state",
        sa.Column("scene", sa.String(length=50), server_default="router:llm", nullable=False),
    )
    op.add_column(
        "bandit_arm_state",
        sa.Column("arm_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "bandit_arm_state",
        sa.Column("reward_metric_type", sa.String(length=50), nullable=True),
    )
    op.execute("UPDATE bandit_arm_state SET arm_id = provider_model_id::text WHERE arm_id IS NULL")
    op.create_unique_constraint(
        "uq_bandit_arm_scene",
        "bandit_arm_state",
        ["scene", "arm_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_bandit_arm_scene", "bandit_arm_state", type_="unique")
    op.drop_column("bandit_arm_state", "reward_metric_type")
    op.drop_column("bandit_arm_state", "arm_id")
    op.drop_column("bandit_arm_state", "scene")
    op.alter_column("bandit_arm_state", "provider_model_id", nullable=False)
