"""
计费与配额数据模型

核心功能:
- tenant_quota: 租户配额表，存储余额、日配额、限流配置
- billing_transaction: 扣费流水表，记录每笔扣费明细，支持幂等防重

配额类型:
- balance: 账户余额（充值获得，扣费减少）
- daily_quota: 日请求配额（每日重置）
- monthly_quota: 月请求配额（每月重置）

事务状态:
- pending: 预扣中
- committed: 已确认
- reversed: 已冲正
"""
import enum
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    UUID as SA_UUID,
)
from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin

# ============================================================
# 枚举定义
# ============================================================

class QuotaResetPeriod(str, enum.Enum):
    """配额重置周期"""
    DAILY = "daily"      # 每日重置
    MONTHLY = "monthly"  # 每月重置
    NEVER = "never"      # 永不重置


class TransactionType(str, enum.Enum):
    """交易类型"""
    DEDUCT = "deduct"      # 扣费
    RECHARGE = "recharge"  # 充值
    REFUND = "refund"      # 退款
    ADJUST = "adjust"      # 调整


class TransactionStatus(str, enum.Enum):
    """交易状态"""
    PENDING = "pending"      # 预扣中
    COMMITTED = "committed"  # 已确认
    REVERSED = "reversed"    # 已冲正


# ============================================================
# 租户配额表
# ============================================================

class TenantQuota(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    租户配额表

    存储租户级别的配额与余额信息，支持多级限流：
    - balance: 账户余额（精度 6 位小数）
    - daily_quota/monthly_quota: 请求配额
    - rpm_limit/tpm_limit: 分钟级限流
    """
    __tablename__ = "tenant_quota"

    # 租户关联
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=False,
        unique=True,
        index=True,
        comment="租户 ID",
    )

    # 余额配置
    balance: Mapped[Decimal] = mapped_column(
        Numeric(18, 6),
        default=Decimal("0"),
        nullable=False,
        comment="账户余额",
    )
    credit_limit: Mapped[Decimal] = mapped_column(
        Numeric(18, 6),
        default=Decimal("0"),
        nullable=False,
        comment="信用额度（允许欠费上限）",
    )

    # 请求配额
    daily_quota: Mapped[int] = mapped_column(
        BigInteger,
        default=10000,
        nullable=False,
        comment="日请求配额",
    )
    daily_used: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        nullable=False,
        comment="日已用请求数",
    )
    daily_reset_at: Mapped[date] = mapped_column(
        Date,
        nullable=True,
        comment="日配额最后重置日期",
    )

    monthly_quota: Mapped[int] = mapped_column(
        BigInteger,
        default=300000,
        nullable=False,
        comment="月请求配额",
    )
    monthly_used: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        nullable=False,
        comment="月已用请求数",
    )
    monthly_reset_at: Mapped[date] = mapped_column(
        Date,
        nullable=True,
        comment="月配额最后重置日期",
    )

    # 分钟级限流
    rpm_limit: Mapped[int] = mapped_column(
        Integer,
        default=60,
        nullable=False,
        comment="每分钟请求数上限",
    )
    tpm_limit: Mapped[int] = mapped_column(
        Integer,
        default=100000,
        nullable=False,
        comment="每分钟 Token 数上限",
    )

    # Token 配额（可选）
    token_quota: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        nullable=False,
        comment="Token 总配额（0 表示不限制）",
    )
    token_used: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        nullable=False,
        comment="已用 Token 数",
    )

    # 状态
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否启用",
    )

    # 版本控制（乐观锁）
    version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
        comment="乐观锁版本号",
    )

    __table_args__ = (
        Index("ix_tenant_quota_tenant_active", "tenant_id", "is_active"),
    )

    def __repr__(self) -> str:
        return f"<TenantQuota tenant={self.tenant_id} balance={self.balance}>"


# ============================================================
# 扣费流水表
# ============================================================

class BillingTransaction(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    扣费流水表

    记录每笔计费明细，支持：
    - 幂等键防重复扣费（trace_id 唯一）
    - 预扣 -> 确认 两阶段
    - 冲正支持
    """
    __tablename__ = "billing_transaction"

    # 关联
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=False,
        index=True,
        comment="租户 ID",
    )
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        index=True,
        comment="API Key ID（可选）",
    )

    # 幂等键
    trace_id: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True,
        comment="请求追踪 ID（幂等键）",
    )

    # 交易信息
    type: Mapped[TransactionType] = mapped_column(
        SAEnum(
            TransactionType,
            name="transaction_type",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=TransactionType.DEDUCT,
        nullable=False,
        comment="交易类型",
    )
    status: Mapped[TransactionStatus] = mapped_column(
        SAEnum(
            TransactionStatus,
            name="transaction_status",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=TransactionStatus.PENDING,
        nullable=False,
        index=True,
        comment="交易状态",
    )

    # 金额与用量
    amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 6),
        nullable=False,
        comment="交易金额",
    )
    input_tokens: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="输入 Token 数",
    )
    output_tokens: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="输出 Token 数",
    )

    # 价格信息
    input_price: Mapped[Decimal] = mapped_column(
        Numeric(18, 8),
        default=Decimal("0"),
        nullable=False,
        comment="输入价格（每千 Token）",
    )
    output_price: Mapped[Decimal] = mapped_column(
        Numeric(18, 8),
        default=Decimal("0"),
        nullable=False,
        comment="输出价格（每千 Token）",
    )

    # 上游信息
    provider: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="提供商名称",
    )
    model: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        index=True,
        comment="模型名称",
    )
    preset_item_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="路由配置项 ID",
    )

    # 扣费前后余额
    balance_before: Mapped[Decimal] = mapped_column(
        Numeric(18, 6),
        nullable=False,
        comment="扣费前余额",
    )
    balance_after: Mapped[Decimal] = mapped_column(
        Numeric(18, 6),
        nullable=False,
        comment="扣费后余额",
    )

    # 备注
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="交易说明",
    )

    # 冲正关联
    reversed_by: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="冲正交易 ID",
    )

    __table_args__ = (
        Index("ix_billing_tx_tenant_created", "tenant_id", "created_at"),
        Index("ix_billing_tx_status_created", "status", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<BillingTransaction {self.trace_id} {self.type.value} {self.amount}>"
