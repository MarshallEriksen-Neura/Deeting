"""create media asset table

Revision ID: 20260115_06_create_media_asset_table
Revises: 20260115_05_add_assistant_summary_tags_metrics
Create Date: 2026-01-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260115_06_create_media_asset_table"
down_revision: Union[str, None] = "20260115_05_add_assistant_summary_tags_metrics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "media_asset",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False, comment="SHA-256 内容哈希（hex）"),
        sa.Column("size_bytes", sa.Integer(), nullable=False, comment="内容大小（字节）"),
        sa.Column("content_type", sa.String(length=120), nullable=False, comment="内容类型"),
        sa.Column("object_key", sa.String(length=512), nullable=False, comment="对象存储 Key"),
        sa.Column("etag", sa.String(length=128), nullable=True, comment="对象存储 ETag"),
        sa.Column(
            "uploader_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="SET NULL"),
            nullable=True,
            comment="上传用户 ID",
        ),
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
        sa.UniqueConstraint("content_hash", "size_bytes", name="uq_media_asset_hash_size"),
        sa.UniqueConstraint("object_key", name="uq_media_asset_object_key"),
    )
    op.create_index("ix_media_asset_content_hash", "media_asset", ["content_hash"])
    op.create_index("ix_media_asset_object_key", "media_asset", ["object_key"])
    op.create_index(
        "idx_media_asset_created_at",
        "media_asset",
        ["created_at"],
        postgresql_using="brin",
    )


def downgrade() -> None:
    op.drop_index("idx_media_asset_created_at", table_name="media_asset")
    op.drop_index("ix_media_asset_object_key", table_name="media_asset")
    op.drop_index("ix_media_asset_content_hash", table_name="media_asset")
    op.drop_table("media_asset")
