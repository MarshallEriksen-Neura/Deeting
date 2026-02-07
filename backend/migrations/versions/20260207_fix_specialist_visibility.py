"""fix integration specialist visibility

Revision ID: fix_specialist_visibility
Revises: seed_more_onboarding_skills
Create Date: 2026-02-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "fix_specialist_visibility"
down_revision = "seed_more_onboarding_skills"
branch_labels = None
depends_on = None

ASSISTANT_ID = "00000000-0000-0000-0000-000000000001"


def upgrade() -> None:
    op.execute(
        sa.text(
            f"UPDATE assistant SET visibility = 'public' WHERE id = '{ASSISTANT_ID}'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            f"UPDATE assistant SET visibility = 'private' WHERE id = '{ASSISTANT_ID}'"
        )
    )
