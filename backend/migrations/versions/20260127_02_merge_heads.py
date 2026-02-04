"""merge heads

Revision ID: 20260127_02_merge_heads
Revises: 20260126_01_add_user_avatar_url, 20260127_01_create_spec_kb_candidate
Create Date: 2026-01-27
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "20260127_02_merge_heads"
down_revision: str | tuple[str, str] | None = (
    "20260126_01_add_user_avatar_url",
    "20260127_01_create_spec_kb_candidate",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
