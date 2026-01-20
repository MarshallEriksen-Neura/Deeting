"""drop provider_model template fields

Revision ID: 20260120_05_drop_provider_model_templates
Revises: 20260120_04_backfill_preset_capability_configs_chat_embedding
Create Date: 2026-01-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260120_05_drop_provider_model_templates"
down_revision = "20260120_04_backfill_preset_capability_configs_chat_embedding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("provider_model", "template_engine")
    op.drop_column("provider_model", "request_template")
    op.drop_column("provider_model", "response_transform")


def downgrade() -> None:
    op.add_column(
        "provider_model",
        sa.Column(
            "template_engine",
            sa.String(length=32),
            nullable=False,
            server_default="simple_replace",
        ),
    )
    op.add_column(
        "provider_model",
        sa.Column(
            "request_template",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "provider_model",
        sa.Column(
            "response_transform",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
