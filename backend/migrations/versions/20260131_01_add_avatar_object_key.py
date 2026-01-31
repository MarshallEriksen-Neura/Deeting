"""add avatar object key and storage type

Revision ID: 20260131_01_add_avatar_object_key
Revises: 20260127_02_merge_heads
Create Date: 2026-01-31
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = "20260131_01_add_avatar_object_key"
down_revision: str | None = "20260127_02_merge_heads"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("user_account")}

    # 添加 avatar_object_key 字段
    if "avatar_object_key" not in columns:
        op.add_column(
            "user_account",
            sa.Column(
                "avatar_object_key",
                sa.String(length=512),
                nullable=True,
                comment="头像对象存储 key",
            ),
        )

    # 添加 avatar_storage_type 字段
    if "avatar_storage_type" not in columns:
        op.add_column(
            "user_account",
            sa.Column(
                "avatar_storage_type",
                sa.String(length=20),
                nullable=False,
                server_default="public",
                comment="头像存储类型: public/private",
            ),
        )

    # 迁移现有数据：将 avatar_url 中的 object_key 提取出来
    # 注意：这里假设 avatar_url 是完整的 URL，需要解析出 object_key
    # 实际迁移时需要根据具体 URL 格式调整
    # 如果 avatar_url 存在，尝试提取 object_key（取 URL 路径最后一部分）
    bind.execute(
        sa.text("""
            UPDATE user_account 
            SET avatar_object_key = SUBSTRING_INDEX(avatar_url, '/', -1),
                avatar_storage_type = 'public'
            WHERE avatar_url IS NOT NULL 
              AND avatar_url != ''
              AND avatar_object_key IS NULL
        """)
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("user_account")}

    if "avatar_storage_type" in columns:
        op.drop_column("user_account", "avatar_storage_type")

    if "avatar_object_key" in columns:
        op.drop_column("user_account", "avatar_object_key")
