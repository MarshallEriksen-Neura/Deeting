"""merge heads

Revision ID: ec076d06f96d
Revises: seed_integration_specialist, 20260201_02_expand_skill_registry
Create Date: 2026-02-03 13:19:47.773723
"""
from alembic import op
import sqlalchemy as sa



# revision identifiers, used by Alembic.
revision = 'ec076d06f96d'
down_revision = ('seed_integration_specialist', '20260201_02_expand_skill_registry')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
