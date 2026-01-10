"""add icon field for provider preset and instance

Revision ID: 20260109_01
Revises: 20260108_04_drop_provider_preset_item
Create Date: 2026-01-09 00:00:00
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260109_01"
down_revision = "20260108_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "provider_preset",
        sa.Column("icon", sa.String(length=255), nullable=False, server_default="lucide:cpu"),
    )
    op.add_column(
        "provider_instance",
        sa.Column("icon", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("provider_instance", "icon")
    op.drop_column("provider_preset", "icon")
