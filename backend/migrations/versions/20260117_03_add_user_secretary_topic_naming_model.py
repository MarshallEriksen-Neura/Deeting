"""Add user secretary topic naming model

Revision ID: 20260117_03_add_user_secretary_topic_naming_model
Revises: 20260117_02_seed_default_assistant
Create Date: 2026-01-17 00:00:00.000000
"""

from typing import Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260117_03_add_user_secretary_topic_naming_model"
down_revision: Union[str, None] = "20260117_02_seed_default_assistant"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("user_secretary"):
        return

    existing_columns = {col["name"] for col in inspector.get_columns("user_secretary")}
    if "topic_naming_model" in existing_columns:
        return

    op.add_column(
        "user_secretary",
        sa.Column(
            "topic_naming_model",
            sa.String(length=128),
            nullable=True,
            comment="话题自动命名使用的模型名称",
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("user_secretary"):
        existing_columns = {col["name"] for col in inspector.get_columns("user_secretary")}
        if "topic_naming_model" in existing_columns:
            op.drop_column("user_secretary", "topic_naming_model")
