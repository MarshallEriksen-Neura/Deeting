"""
BanditArmState: 记录多臂赌博路由的臂级状态

设计目标：
- 持久化每个 preset_item 的反馈（成功/失败次数、延迟、成本）
- 支持不同策略参数（epsilon-greedy / UCB / Thompson）
- 维护冷却期，便于自动降级
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    UUID as SA_UUID,
)
from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class BanditStrategy(str, enum.Enum):
    """支持的 Bandit 策略"""

    EPSILON_GREEDY = "epsilon_greedy"
    UCB1 = "ucb1"
    THOMPSON = "thompson"


class BanditArmState(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """多臂赌博臂状态"""

    __tablename__ = "bandit_arm_state"

    provider_model_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("provider_model.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
        comment="关联的 provider_model（BYOP 实例下的模型）",
    )

    # 策略参数
    strategy: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=BanditStrategy.EPSILON_GREEDY.value,
        server_default=BanditStrategy.EPSILON_GREEDY.value,
        comment="策略名称",
    )
    epsilon: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.1,
        server_default="0.1",
        comment="epsilon-greedy 探索率",
    )
    alpha: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.0,
        server_default="1.0",
        comment="Thompson Beta 分布 alpha",
    )
    beta: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.0,
        server_default="1.0",
        comment="Thompson Beta 分布 beta",
    )

    # 反馈统计
    total_trials: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
        comment="总尝试次数",
    )
    successes: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
        comment="成功次数",
    )
    failures: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
        comment="失败次数",
    )
    total_latency_ms: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
        comment="累计延迟（毫秒）",
    )
    latency_p95_ms: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
        comment="近窗 95 分位延迟（毫秒）",
    )
    total_cost: Mapped[Decimal] = mapped_column(
        Numeric(18, 8),
        nullable=False,
        default=Decimal("0"),
        server_default="0",
        comment="累计成本",
    )
    last_reward: Mapped[Decimal] = mapped_column(
        Numeric(18, 8),
        nullable=False,
        default=Decimal("0"),
        server_default="0",
        comment="最近一次奖励值",
    )

    # 降级与版本
    cooldown_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="冷却期截止时间",
    )
    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
        comment="状态版本",
    )

    __table_args__ = (
        UniqueConstraint("provider_model_id", name="uq_bandit_arm_state_model"),
    )

    def avg_latency_ms(self) -> float:
        if self.total_trials <= 0:
            return 0.0
        return float(self.total_latency_ms) / float(self.total_trials)
