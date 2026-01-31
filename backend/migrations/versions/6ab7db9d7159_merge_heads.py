"""merge_heads

Revision ID: 6ab7db9d7159
Revises: 20260131_01_add_avatar_object_key, 20260131_02_add_used_persona_id
Create Date: 2026-01-31 06:34:09.762109
"""
from alembic import op
import sqlalchemy as sa



# revision identifiers, used by Alembic.
revision = '6ab7db9d7159'
down_revision = ('20260131_01_add_avatar_object_key', '20260131_02_add_used_persona_id')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
