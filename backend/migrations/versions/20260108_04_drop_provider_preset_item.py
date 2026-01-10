"""drop provider_preset_item table (legacy)

Revision ID: 20260108_04
Revises: 20260108_03
Create Date: 2026-01-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260108_04"
down_revision = "20260108_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("provider_preset_item")


def downgrade() -> None:
    op.create_table(
        "provider_preset_item",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("preset_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("provider_preset.id", ondelete="CASCADE"), nullable=False),
        sa.Column("capability", sa.String(length=32), nullable=False),
        sa.Column("subtype", sa.String(length=32), nullable=True),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("unified_model_id", sa.String(length=128), nullable=True),
        sa.Column("upstream_path", sa.String(length=255), nullable=False),
        sa.Column("template_engine", sa.String(length=32), nullable=False, server_default=sa.text("'simple_replace'")),
        sa.Column("request_template", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("response_transform", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("pricing_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("limit_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("tokenizer_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("routing_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("channel", sa.String(length=16), nullable=False, server_default=sa.text("'external'")),
        sa.Column("visibility", sa.String(length=16), nullable=False, server_default=sa.text("'private'")),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("shared_scope", sa.String(length=32), nullable=True),
        sa.Column("shared_targets", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("weight", sa.Integer(), nullable=False, server_default=sa.text("100")),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_unique_constraint("uq_preset_item_identity", "provider_preset_item", ["preset_id", "capability", "model", "upstream_path"])
    op.create_index("ix_preset_item_lookup", "provider_preset_item", ["preset_id", "capability"], unique=False)
    op.create_index("ix_provider_preset_item_unified_model_id", "provider_preset_item", ["unified_model_id"], unique=False)
