"""add provider instance and model tables

Revision ID: 20260108_01
Revises: 20260107_03
Create Date: 2026-01-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260108_01"
down_revision = "20260107_03_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_instance",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("preset_slug", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("base_url", sa.String(length=255), nullable=False),
        sa.Column("credentials_ref", sa.String(length=128), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False, server_default=sa.text("'external'")),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_provider_instance_user", "provider_instance", ["user_id"], unique=False)
    op.create_index("ix_provider_instance_preset_slug", "provider_instance", ["preset_slug"], unique=False)

    op.create_table(
        "provider_model",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("instance_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("provider_instance.id", ondelete="CASCADE"), nullable=False),
        sa.Column("capability", sa.String(length=32), nullable=False),
        sa.Column("model_id", sa.String(length=128), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=True),
        sa.Column("upstream_path", sa.String(length=255), nullable=False),
        sa.Column("template_engine", sa.String(length=32), nullable=False, server_default=sa.text("'simple_replace'")),
        sa.Column("request_template", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("response_transform", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("pricing_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("limit_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("tokenizer_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("routing_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("source", sa.String(length=16), nullable=False, server_default=sa.text("'auto'")),
        sa.Column("extra_meta", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("weight", sa.Integer(), nullable=False, server_default=sa.text("100")),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("instance_id", "capability", "model_id", "upstream_path", name="uq_provider_model_identity"),
    )
    op.create_index("ix_provider_model_lookup", "provider_model", ["instance_id", "capability"], unique=False)
    op.create_index("ix_provider_model_model_id", "provider_model", ["model_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_provider_model_model_id", table_name="provider_model")
    op.drop_index("ix_provider_model_lookup", table_name="provider_model")
    op.drop_table("provider_model")

    op.drop_index("ix_provider_instance_preset_slug", table_name="provider_instance")
    op.drop_index("ix_provider_instance_user", table_name="provider_instance")
    op.drop_table("provider_instance")
