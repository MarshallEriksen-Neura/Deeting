"""add api key secret fields for HMAC signing

Revision ID: 20260106_05
Revises: 20260106_04
Create Date: 2026-01-06

为 API Key 添加独立的签名密钥字段：
- secret_hash: HMAC 签名专用的 Secret 哈希
- secret_hint: Secret 末 4 位提示

安全考虑：
- API Key 用于身份认证，Secret 用于请求签名
- 两者分离可独立轮换，降低泄露风险
- 签名失败不会暴露 API Key
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260106_05"
down_revision = "20260106_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 添加 secret_hash 字段
    op.add_column(
        "api_key",
        sa.Column(
            "secret_hash",
            sa.String(64),
            nullable=True,
            comment="HMAC 签名专用 Secret 哈希 (独立于 key_hash)",
        ),
    )

    # 添加 secret_hint 字段
    op.add_column(
        "api_key",
        sa.Column(
            "secret_hint",
            sa.String(8),
            nullable=True,
            comment="Secret 末 4 位 (****wxyz)",
        ),
    )

    # 为 secret_hash 创建索引（用于快速查找）
    op.create_index(
        "ix_api_key_secret_hash",
        "api_key",
        ["secret_hash"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_api_key_secret_hash", table_name="api_key")
    op.drop_column("api_key", "secret_hint")
    op.drop_column("api_key", "secret_hash")
