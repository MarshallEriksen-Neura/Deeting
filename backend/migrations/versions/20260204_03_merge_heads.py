"""merge heads

Revision ID: 20260204_03_merge_heads
Revises: 20260204_02_add_trace_feedback, ec076d06f96d
Create Date: 2026-02-04
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "20260204_03_merge_heads"
down_revision: str | tuple[str, str] | None = (
    "20260204_02_add_trace_feedback",
    "ec076d06f96d",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
