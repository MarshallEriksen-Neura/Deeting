"""add user secretary model name

Revision ID: 20260115_07_add_user_secretary_model
Revises: 20260115_06_add_assistant_rating_table, 20260115_06_create_media_asset_table
Create Date: 2026-01-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260115_07_add_user_secretary_model"
down_revision: Union[str, tuple[str, str], None] = (
    "20260115_06_add_assistant_rating_table",
    "20260115_06_create_media_asset_table",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_secretary",
        sa.Column("model_name", sa.String(length=128), nullable=True, comment="秘书使用的模型名称"),
    )


def downgrade() -> None:
    op.drop_column("user_secretary", "model_name")
