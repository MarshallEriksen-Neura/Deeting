"""create_user_document_table

Revision ID: 20260206_01
Revises: 20260204_03_merge_heads
Create Date: 2026-02-06 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260206_01"
down_revision: Union[str, None] = "20260204_03_merge_heads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_document",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("media_asset_id", sa.UUID(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False, comment="显示文件名"),
        sa.Column("status", sa.String(length=50), server_default="pending", nullable=False, comment="状态"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("chunk_count", sa.Integer(), server_default="0", nullable=True),
        sa.Column("embedding_model", sa.String(length=100), nullable=True),
        sa.Column("meta_info", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["media_asset_id"], ["media_asset.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["user_account.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_document_media_asset_id", "user_document", ["media_asset_id"], unique=False)
    op.create_index("ix_user_document_status", "user_document", ["status"], unique=False)
    op.create_index("ix_user_document_user_id", "user_document", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_document_user_id", table_name="user_document")
    op.drop_index("ix_user_document_status", table_name="user_document")
    op.drop_index("ix_user_document_media_asset_id", table_name="user_document")
    op.drop_table("user_document")
