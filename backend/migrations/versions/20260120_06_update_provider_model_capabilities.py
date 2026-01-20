"""update provider_model capabilities

Revision ID: 20260120_06_update_provider_model_capabilities
Revises: 20260120_05_drop_provider_model_templates
Create Date: 2026-01-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260120_06_update_provider_model_capabilities"
down_revision = "20260120_05_drop_provider_model_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add capabilities column
    op.add_column(
        "provider_model",
        sa.Column(
            "capabilities",
            postgresql.ARRAY(sa.String(length=32)),
            nullable=True,  # Temporarily nullable for population
            server_default="{}"
        ),
    )
    
    # 2. Populate capabilities from capability
    op.execute("UPDATE provider_model SET capabilities = ARRAY[capability]")
    
    # 3. Make capabilities non-nullable
    op.alter_column("provider_model", "capabilities", nullable=False)
    
    # 4. Drop old indexes/constraints
    # Note: Explicitly drop the constraint by name.
    # If the name wasn't explicitly set in previous migrations, this might fail,
    # but the model definition had `name="uq_provider_model_identity"`.
    op.drop_constraint("uq_provider_model_identity", "provider_model", type_="unique")
    op.drop_index("uq_provider_model_unified", table_name="provider_model")
    op.drop_index("ix_provider_model_lookup", table_name="provider_model")
    
    # 5. Drop capability column
    op.drop_column("provider_model", "capability")
    
    # 6. Create new indexes/constraints
    # UniqueConstraint("instance_id", "model_id", "upstream_path", name="uq_provider_model_identity")
    op.create_unique_constraint(
        "uq_provider_model_identity",
        "provider_model",
        ["instance_id", "model_id", "upstream_path"]
    )
    
    # Index("uq_provider_model_unified", "instance_id", "unified_model_id", unique=True, postgresql_where=text("unified_model_id IS NOT NULL"))
    op.create_index(
        "uq_provider_model_unified",
        "provider_model",
        ["instance_id", "unified_model_id"],
        unique=True,
        postgresql_where=sa.text("unified_model_id IS NOT NULL")
    )
    
    # Index("ix_provider_model_instance_id", "instance_id")
    op.create_index(
        "ix_provider_model_instance_id",
        "provider_model",
        ["instance_id"]
    )
    
    # Index("ix_provider_model_capabilities", "capabilities", postgresql_using="gin")
    op.create_index(
        "ix_provider_model_capabilities",
        "provider_model",
        ["capabilities"],
        postgresql_using="gin"
    )


def downgrade() -> None:
    # 1. Add capability column
    op.add_column(
        "provider_model",
        sa.Column(
            "capability",
            sa.String(length=32),
            nullable=True,
        ),
    )
    
    # 2. Populate capability from capabilities[1] (assuming first element)
    # This is lossy if there are multiple capabilities, but acceptable for downgrade
    op.execute("UPDATE provider_model SET capability = capabilities[1]")
    
    # 3. Make capability non-nullable
    op.alter_column("provider_model", "capability", nullable=False)
    
    # 4. Drop new indexes/constraints
    op.drop_constraint("uq_provider_model_identity", "provider_model", type_="unique")
    op.drop_index("uq_provider_model_unified", table_name="provider_model")
    op.drop_index("ix_provider_model_instance_id", table_name="provider_model")
    op.drop_index("ix_provider_model_capabilities", table_name="provider_model")
    
    # 5. Drop capabilities column
    op.drop_column("provider_model", "capabilities")
    
    # 6. Restore old indexes/constraints
    op.create_unique_constraint(
        "uq_provider_model_identity",
        "provider_model",
        ["instance_id", "capability", "model_id", "upstream_path"]
    )
    
    op.create_index(
        "uq_provider_model_unified",
        "provider_model",
        ["instance_id", "capability", "unified_model_id"],
        unique=True,
        postgresql_where=sa.text("unified_model_id IS NOT NULL")
    )
    
    op.create_index(
        "ix_provider_model_lookup",
        "provider_model",
        ["instance_id", "capability"]
    )
