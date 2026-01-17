"""Add system setting table and secretary embedding model

Revision ID: 20260117_01_add_system_setting_and_secretary_embedding_model
Revises: 20260116_02_add_conversation_session_assistant_id
Create Date: 2026-01-17 00:00:00.000000
"""

from typing import Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260117_01_add_system_setting_and_secretary_embedding_model"
down_revision: Union[str, None] = "20260116_02_add_conversation_session_assistant_id"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("system_setting"):
        op.create_table(
            "system_setting",
            sa.Column("key", sa.String(length=128), nullable=False, comment="Setting key"),
            sa.Column("value", sa.JSON(), nullable=False, comment="Setting value (JSON)"),
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_system_setting_key"), "system_setting", ["key"], unique=True)

    if not inspector.has_table("user_secretary"):
        return

    existing_columns = {col["name"] for col in inspector.get_columns("user_secretary")}
    if "embedding_model" in existing_columns:
        return

    op.add_column(
        "user_secretary",
        sa.Column(
            "embedding_model",
            sa.String(length=128),
            nullable=True,
            comment="秘书向量使用的 embedding 模型名称",
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("user_secretary"):
        existing_columns = {col["name"] for col in inspector.get_columns("user_secretary")}
        if "embedding_model" in existing_columns:
            op.drop_column("user_secretary", "embedding_model")

    if inspector.has_table("system_setting"):
        op.drop_index(op.f("ix_system_setting_key"), table_name="system_setting")
        op.drop_table("system_setting")
