"""add generation task fields

Revision ID: 20260121_02_add_generation_task_fields
Revises: 20260121_01_add_conversation_meta_summary_link
Create Date: 2026-01-21
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260121_02_add_generation_task_fields"
down_revision: Union[str, None] = "20260121_01_add_conversation_meta_summary_link"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else "postgresql"

    json_type = postgresql.JSONB() if dialect == "postgresql" else sa.JSON()
    json_default = sa.text("'{}'::jsonb") if dialect == "postgresql" else sa.text("'{}'")

    op.add_column(
        "image_generation_task",
        sa.Column(
            "task_type",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'image_generation'"),
            comment="任务类型（image_generation/text_to_speech/video_generation）",
        ),
    )
    op.add_column(
        "image_generation_task",
        sa.Column(
            "input_params",
            json_type,
            nullable=False,
            server_default=json_default,
            comment="通用输入参数（JSONB）",
        ),
    )
    op.add_column(
        "image_generation_task",
        sa.Column(
            "output_meta",
            json_type,
            nullable=False,
            server_default=json_default,
            comment="通用输出元信息（JSONB）",
        ),
    )


def downgrade() -> None:
    op.drop_column("image_generation_task", "output_meta")
    op.drop_column("image_generation_task", "input_params")
    op.drop_column("image_generation_task", "task_type")
