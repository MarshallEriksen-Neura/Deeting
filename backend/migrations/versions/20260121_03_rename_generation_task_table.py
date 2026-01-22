"""rename image generation task table

Revision ID: 20260121_03_rename_generation_task_table
Revises: 20260121_02_add_generation_task_fields
Create Date: 2026-01-21
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260121_03_rename_generation_task_table"
down_revision: Union[str, None] = "20260121_02_add_generation_task_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.rename_table("image_generation_task", "generation_task")


def downgrade() -> None:
    op.rename_table("generation_task", "image_generation_task")
