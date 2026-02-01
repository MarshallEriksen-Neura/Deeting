"""add skill_registry table

Revision ID: 20260201_01_add_skill_registry
Revises: 20260131_03_add_assistant_routing_state
Create Date: 2026-02-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260201_01_add_skill_registry"
down_revision: Union[str, None] = "20260131_03_add_assistant_routing_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "skill_registry",
        sa.Column(
            "id",
            sa.String(length=120),
            primary_key=True,
            comment="技能唯一标识（如 core.tools.crawler）",
        ),
        sa.Column(
            "name",
            sa.String(length=200),
            nullable=False,
            comment="技能名称",
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="draft",
            comment="技能状态: draft/active/disabled",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            comment="创建时间",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            comment="更新时间",
        ),
    )


def downgrade() -> None:
    op.drop_table("skill_registry")
