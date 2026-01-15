"""add assistant summary, tag tables, and metrics

Revision ID: 20260115_05_add_assistant_summary_tags_metrics
Revises: 20260115_04_create_assistant_market_tables
Create Date: 2026-01-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260115_05_add_assistant_summary_tags_metrics"
down_revision: Union[str, None] = "20260115_04_create_assistant_market_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("assistant", sa.Column("summary", sa.String(length=200), nullable=True, comment="助手简介（两行展示）"))
    op.add_column(
        "assistant",
        sa.Column("install_count", sa.Integer(), nullable=False, server_default="0", comment="安装量"),
    )
    op.add_column(
        "assistant",
        sa.Column("rating_avg", sa.Float(), nullable=False, server_default="0.0", comment="评分均值"),
    )
    op.add_column(
        "assistant",
        sa.Column("rating_count", sa.Integer(), nullable=False, server_default="0", comment="评分数量"),
    )

    op.create_table(
        "assistant_tag",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False, comment="标签名称（如 #Python）"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("name", name="uq_assistant_tag_name"),
    )
    op.create_index("ix_assistant_tag_name", "assistant_tag", ["name"])

    op.create_table(
        "assistant_tag_link",
        sa.Column(
            "assistant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assistant.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
            comment="助手 ID",
        ),
        sa.Column(
            "tag_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assistant_tag.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
            comment="标签 ID",
        ),
    )
    op.create_index("ix_assistant_tag_link_assistant", "assistant_tag_link", ["assistant_id"])
    op.create_index("ix_assistant_tag_link_tag", "assistant_tag_link", ["tag_id"])
    op.create_unique_constraint("uq_assistant_tag_link", "assistant_tag_link", ["assistant_id", "tag_id"])


def downgrade() -> None:
    op.drop_constraint("uq_assistant_tag_link", "assistant_tag_link", type_="unique")
    op.drop_index("ix_assistant_tag_link_tag", table_name="assistant_tag_link")
    op.drop_index("ix_assistant_tag_link_assistant", table_name="assistant_tag_link")
    op.drop_table("assistant_tag_link")

    op.drop_index("ix_assistant_tag_name", table_name="assistant_tag")
    op.drop_table("assistant_tag")

    op.drop_column("assistant", "rating_count")
    op.drop_column("assistant", "rating_avg")
    op.drop_column("assistant", "install_count")
    op.drop_column("assistant", "summary")
