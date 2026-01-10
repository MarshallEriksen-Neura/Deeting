"""switch bandit arm to provider_model

Revision ID: 20260108_02
Revises: 20260108_01
Create Date: 2026-01-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260108_02"
down_revision = "20260108_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bandit_arm_state") as batch:
        batch.drop_index("ix_bandit_arm_state_preset_item_id")
        batch.drop_column("preset_item_id")
        batch.add_column(sa.Column("provider_model_id", postgresql.UUID(as_uuid=True), nullable=False))
        batch.create_index("ix_bandit_arm_state_provider_model_id", ["provider_model_id"], unique=True)
        batch.create_unique_constraint("uq_bandit_arm_state_model", ["provider_model_id"])
        batch.create_foreign_key(
            "fk_bandit_arm_state_provider_model",
            "provider_model",
            ["provider_model_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    with op.batch_alter_table("bandit_arm_state") as batch:
        batch.drop_constraint("fk_bandit_arm_state_provider_model", type_="foreignkey")
        batch.drop_constraint("uq_bandit_arm_state_model", type_="unique")
        batch.drop_index("ix_bandit_arm_state_provider_model_id")
        batch.drop_column("provider_model_id")
        batch.add_column(sa.Column("preset_item_id", postgresql.UUID(as_uuid=True), nullable=False))
        batch.create_index("ix_bandit_arm_state_preset_item_id", ["preset_item_id"], unique=True)
        batch.create_unique_constraint("uq_bandit_arm_state_item", ["preset_item_id"])
        batch.create_foreign_key(
            "fk_bandit_arm_state_preset_item",
            "provider_preset_item",
            ["preset_item_id"],
            ["id"],
            ondelete="CASCADE",
        )
