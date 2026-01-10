"""rename provider_instance.metadata to meta

Revision ID: 20260108_05
Revises: 20260108_04
Create Date: 2026-01-08
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260108_05"
down_revision = "20260108_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("provider_instance", "metadata", new_column_name="meta")


def downgrade() -> None:
    op.alter_column("provider_instance", "meta", new_column_name="metadata")
