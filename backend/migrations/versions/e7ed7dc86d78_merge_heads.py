"""merge heads

Revision ID: e7ed7dc86d78
Revises: 20260117_03_add_user_secretary_topic_naming_model, 20260117_03_drop_provider_instance_channel
Create Date: 2026-01-17 06:44:41.398411
"""
from alembic import op
import sqlalchemy as sa



# revision identifiers, used by Alembic.
revision = 'e7ed7dc86d78'
down_revision = ('20260117_03_add_user_secretary_topic_naming_model', '20260117_03_drop_provider_instance_channel')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
