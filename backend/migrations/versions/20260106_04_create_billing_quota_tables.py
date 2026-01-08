"""create billing and quota tables

Revision ID: 20260106_04
Revises: 20260106_03_create_conversation_tables
Create Date: 2026-01-06 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260106_04"
down_revision: str | None = "20260106_03_create_conversation_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 创建枚举类型
    transaction_type_enum = postgresql.ENUM(
        "deduct", "recharge", "refund", "adjust",
        name="transaction_type",
        create_type=False,
    )
    transaction_status_enum = postgresql.ENUM(
        "pending", "committed", "reversed",
        name="transaction_status",
        create_type=False,
    )

    # 先创建枚举类型
    op.execute("CREATE TYPE transaction_type AS ENUM ('deduct', 'recharge', 'refund', 'adjust')")
    op.execute("CREATE TYPE transaction_status AS ENUM ('pending', 'committed', 'reversed')")

    # 创建 tenant_quota 表
    op.create_table(
        "tenant_quota",
        sa.Column("id", sa.UUID(), nullable=False, comment="主键 ID"),
        sa.Column("tenant_id", sa.UUID(), nullable=False, comment="租户 ID"),
        # 余额配置
        sa.Column("balance", sa.Numeric(18, 6), nullable=False, server_default="0", comment="账户余额"),
        sa.Column("credit_limit", sa.Numeric(18, 6), nullable=False, server_default="0", comment="信用额度"),
        # 日配额
        sa.Column("daily_quota", sa.BigInteger(), nullable=False, server_default="10000", comment="日请求配额"),
        sa.Column("daily_used", sa.BigInteger(), nullable=False, server_default="0", comment="日已用请求数"),
        sa.Column("daily_reset_at", sa.Date(), nullable=True, comment="日配额最后重置日期"),
        # 月配额
        sa.Column("monthly_quota", sa.BigInteger(), nullable=False, server_default="300000", comment="月请求配额"),
        sa.Column("monthly_used", sa.BigInteger(), nullable=False, server_default="0", comment="月已用请求数"),
        sa.Column("monthly_reset_at", sa.Date(), nullable=True, comment="月配额最后重置日期"),
        # 分钟级限流
        sa.Column("rpm_limit", sa.Integer(), nullable=False, server_default="60", comment="每分钟请求数上限"),
        sa.Column("tpm_limit", sa.Integer(), nullable=False, server_default="100000", comment="每分钟 Token 数上限"),
        # Token 配额
        sa.Column("token_quota", sa.BigInteger(), nullable=False, server_default="0", comment="Token 总配额"),
        sa.Column("token_used", sa.BigInteger(), nullable=False, server_default="0", comment="已用 Token 数"),
        # 状态
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true", comment="是否启用"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1", comment="乐观锁版本号"),
        # 时间戳
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_tenant_quota"),
        sa.UniqueConstraint("tenant_id", name="uq_tenant_quota_tenant_id"),
    )
    op.create_index("ix_tenant_quota_tenant_id", "tenant_quota", ["tenant_id"])
    op.create_index("ix_tenant_quota_tenant_active", "tenant_quota", ["tenant_id", "is_active"])

    # 创建 billing_transaction 表
    op.create_table(
        "billing_transaction",
        sa.Column("id", sa.UUID(), nullable=False, comment="主键 ID"),
        sa.Column("tenant_id", sa.UUID(), nullable=False, comment="租户 ID"),
        sa.Column("api_key_id", sa.UUID(), nullable=True, comment="API Key ID"),
        # 幂等键
        sa.Column("trace_id", sa.String(64), nullable=False, comment="请求追踪 ID（幂等键）"),
        # 交易信息
        sa.Column(
            "type",
            transaction_type_enum,
            nullable=False,
            server_default="deduct",
            comment="交易类型",
        ),
        sa.Column(
            "status",
            transaction_status_enum,
            nullable=False,
            server_default="pending",
            comment="交易状态",
        ),
        # 金额与用量
        sa.Column("amount", sa.Numeric(18, 6), nullable=False, comment="交易金额"),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0", comment="输入 Token 数"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0", comment="输出 Token 数"),
        # 价格信息
        sa.Column("input_price", sa.Numeric(18, 8), nullable=False, server_default="0", comment="输入价格"),
        sa.Column("output_price", sa.Numeric(18, 8), nullable=False, server_default="0", comment="输出价格"),
        # 上游信息
        sa.Column("provider", sa.String(64), nullable=True, comment="提供商名称"),
        sa.Column("model", sa.String(128), nullable=True, comment="模型名称"),
        sa.Column("preset_item_id", sa.UUID(), nullable=True, comment="路由配置项 ID"),
        # 扣费前后余额
        sa.Column("balance_before", sa.Numeric(18, 6), nullable=False, comment="扣费前余额"),
        sa.Column("balance_after", sa.Numeric(18, 6), nullable=False, comment="扣费后余额"),
        # 备注
        sa.Column("description", sa.Text(), nullable=True, comment="交易说明"),
        sa.Column("reversed_by", sa.UUID(), nullable=True, comment="冲正交易 ID"),
        # 时间戳
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_billing_transaction"),
        sa.UniqueConstraint("trace_id", name="uq_billing_transaction_trace_id"),
    )
    op.create_index("ix_billing_transaction_tenant_id", "billing_transaction", ["tenant_id"])
    op.create_index("ix_billing_transaction_api_key_id", "billing_transaction", ["api_key_id"])
    op.create_index("ix_billing_transaction_trace_id", "billing_transaction", ["trace_id"])
    op.create_index("ix_billing_transaction_status", "billing_transaction", ["status"])
    op.create_index("ix_billing_transaction_model", "billing_transaction", ["model"])
    op.create_index("ix_billing_tx_tenant_created", "billing_transaction", ["tenant_id", "created_at"])
    op.create_index("ix_billing_tx_status_created", "billing_transaction", ["status", "created_at"])


def downgrade() -> None:
    op.drop_table("billing_transaction")
    op.drop_table("tenant_quota")
    op.execute("DROP TYPE IF EXISTS transaction_status")
    op.execute("DROP TYPE IF EXISTS transaction_type")
