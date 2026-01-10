"""merge heads bb8a5d94940c and 20260107_02

Revision ID: 20260107_03_merge_heads
Revises: bb8a5d94940c, 20260107_02
Create Date: 2026-01-07 13:30:00.000000

"""
from __future__ import annotations

from alembic import op


revision = "20260107_03_merge_heads"
down_revision = ("bb8a5d94940c", "20260107_02", "20260107_02b")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
