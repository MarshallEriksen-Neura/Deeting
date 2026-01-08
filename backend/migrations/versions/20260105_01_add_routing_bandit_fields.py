"""add routing_config and channel to provider_preset_item

Revision ID: 20260105_01
Revises: 20260104_02
Create Date: 2026-01-05
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260105_01"
down_revision = "20260104_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "provider_preset_item",
        sa.Column(
            "channel",
            sa.String(length=16),
            nullable=False,
            server_default="external",
            comment="可用通道: internal / external / both",
        ),
    )
    op.add_column(
        "provider_preset_item",
        sa.Column(
            "routing_config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="路由策略配置（bandit/灰度/熔断）",
        ),
    )


def downgrade() -> None:
    op.drop_column("provider_preset_item", "routing_config")
    op.drop_column("provider_preset_item", "channel")
