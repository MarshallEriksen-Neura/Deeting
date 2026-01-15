"""add assistant rating table

Revision ID: 20260115_06_add_assistant_rating_table
Revises: 20260115_05_add_assistant_summary_tags_metrics
Create Date: 2026-01-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260115_06_add_assistant_rating_table"
down_revision: Union[str, None] = "20260115_05_add_assistant_summary_tags_metrics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assistant_rating",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
            comment="评分用户 ID",
        ),
        sa.Column(
            "assistant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assistant.id", ondelete="CASCADE"),
            nullable=False,
            comment="助手 ID",
        ),
        sa.Column("rating", sa.Float(), nullable=False, comment="评分（1-5）"),
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
        sa.UniqueConstraint("user_id", "assistant_id", name="uq_assistant_rating_user"),
    )
    op.create_index("ix_assistant_rating_user", "assistant_rating", ["user_id"])
    op.create_index("ix_assistant_rating_assistant", "assistant_rating", ["assistant_id"])


def downgrade() -> None:
    op.drop_index("ix_assistant_rating_assistant", table_name="assistant_rating")
    op.drop_index("ix_assistant_rating_user", table_name="assistant_rating")
    op.drop_table("assistant_rating")
