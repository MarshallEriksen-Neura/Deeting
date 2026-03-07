"""create alipay recharge order table

Revision ID: 20260307_01_create_alipay_recharge_order
Revises: 20260306_03_merge_heads
Create Date: 2026-03-07
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260307_01_create_alipay_recharge_order"
down_revision: str | Sequence[str] | None = "20260306_03_merge_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "alipay_recharge_order",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("out_trade_no", sa.String(64), nullable=False),
        sa.Column("trade_no", sa.String(64), nullable=True),
        sa.Column(
            "status",
            sa.Enum("PENDING", "SUCCESS", "FAILED", name="alipayrechargeorderstatus"),
            nullable=False,
        ),
        sa.Column("trade_status", sa.String(64), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency", sa.String(16), nullable=False),
        sa.Column("credit_per_unit", sa.Numeric(18, 6), nullable=False),
        sa.Column("expected_credited_amount", sa.Numeric(18, 6), nullable=False),
        sa.Column("pay_url", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index("ix_alipay_recharge_order_tenant_id", "alipay_recharge_order", ["tenant_id"])
    op.create_index("ix_alipay_recharge_order_out_trade_no", "alipay_recharge_order", ["out_trade_no"], unique=True)
    op.create_index("ix_alipay_recharge_order_trade_no", "alipay_recharge_order", ["trade_no"])
    op.create_index("ix_alipay_recharge_order_status", "alipay_recharge_order", ["status"])
    op.create_index("ix_alipay_recharge_order_last_checked_at", "alipay_recharge_order", ["last_checked_at"])
    op.create_index(
        "ix_alipay_recharge_order_tenant_created",
        "alipay_recharge_order",
        ["tenant_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_alipay_recharge_order_tenant_created", table_name="alipay_recharge_order")
    op.drop_index("ix_alipay_recharge_order_last_checked_at", table_name="alipay_recharge_order")
    op.drop_index("ix_alipay_recharge_order_status", table_name="alipay_recharge_order")
    op.drop_index("ix_alipay_recharge_order_trade_no", table_name="alipay_recharge_order")
    op.drop_index("ix_alipay_recharge_order_out_trade_no", table_name="alipay_recharge_order")
    op.drop_index("ix_alipay_recharge_order_tenant_id", table_name="alipay_recharge_order")
    op.drop_table("alipay_recharge_order")
    sa.Enum(name="alipayrechargeorderstatus").drop(op.get_bind(), checkfirst=True)
