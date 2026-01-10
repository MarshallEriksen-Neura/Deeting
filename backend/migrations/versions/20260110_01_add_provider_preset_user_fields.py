"""add provider preset theme color and instance description

Revision ID: 20260110_01_add_provider_preset_user_fields
Revises: 20260109_07_add_api_key_user_fields
Create Date: 2026-01-10 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20260110_01_add_provider_preset_user_fields'
down_revision = '20260109_07_add_api_key_user_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # provider_preset changes: ONLY theme_color
    op.add_column('provider_preset', sa.Column('theme_color', sa.String(length=20), nullable=True, comment='品牌主色调 (Hex/Tailwind class)'))

    # provider_instance changes: description
    op.add_column('provider_instance', sa.Column('description', sa.String(length=255), nullable=True, comment='实例描述'))


def downgrade() -> None:
    # provider_instance changes
    op.drop_column('provider_instance', 'description')

    # provider_preset changes
    op.drop_column('provider_preset', 'theme_color')