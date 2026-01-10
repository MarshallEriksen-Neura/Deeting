"""add provider credential table

Revision ID: 20260109_05
Revises: 20260109_04_sync_permission_registry
Create Date: 2026-01-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260109_05"
down_revision = "20260109_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_credential",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "instance_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("provider_instance.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("alias", sa.String(length=80), nullable=False),
        sa.Column("secret_ref_id", sa.String(length=128), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("instance_id", "alias", name="uq_provider_credential_alias"),
    )
    op.create_index("ix_provider_credential_instance", "provider_credential", ["instance_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_provider_credential_instance", table_name="provider_credential")
    op.drop_table("provider_credential")
