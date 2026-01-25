"""create image generation share tag link table

Revision ID: 20260124_03_create_image_generation_share_tag_link
Revises: 20260124_02_create_image_generation_share_table
Create Date: 2026-01-24
"""

from __future__ import annotations

from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260124_03_create_image_generation_share_tag_link"
down_revision: Union[str, None] = "20260124_02_create_image_generation_share_table"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "image_generation_share_tag_link",
        sa.Column("share_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["share_id"],
            ["image_generation_share.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tag_id"],
            ["assistant_tag.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_image_share_tag_link_share",
        "image_generation_share_tag_link",
        ["share_id"],
    )
    op.create_index(
        "ix_image_share_tag_link_tag",
        "image_generation_share_tag_link",
        ["tag_id"],
    )
    op.create_unique_constraint(
        "uq_image_share_tag_link",
        "image_generation_share_tag_link",
        ["share_id", "tag_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_image_share_tag_link",
        "image_generation_share_tag_link",
        type_="unique",
    )
    op.drop_index(
        "ix_image_share_tag_link_tag",
        table_name="image_generation_share_tag_link",
    )
    op.drop_index(
        "ix_image_share_tag_link_share",
        table_name="image_generation_share_tag_link",
    )
    op.drop_table("image_generation_share_tag_link")
