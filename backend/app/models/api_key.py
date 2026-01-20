"""
API Key 数据模型

核心功能:
- api_key: 主表，存储 Key 哈希、类型、状态、绑定关系
- api_key_scope: 权限范围表，支持 capability/model/endpoint 级别的黑白名单
- api_key_rate_limit: 限流配置表，Key 级别的 rpm/tpm/rpd/tpd
- api_key_quota: 配额表，支持 token/request/cost 类型配额
- api_key_ip_whitelist: IP 白名单表
- api_key_usage: 使用统计表（可选，或写入时序数据库）

Key 类型:
- internal: 内部服务/前端使用，绑定 user_id
- external: 外部租户使用，绑定 tenant_id

Key 状态:
- active: 正常使用
- expiring: 即将过期（轮换期间，旧 Key 短期可用）
- revoked: 已吊销
- expired: 已过期

安全设计:
- 仅存储 key_hash (HMAC-SHA256)，不落明文
- key_hint 存储末 4 位，便于用户辨识
- key_prefix 区分类型 (sk-ext- / sk-int-)

使用示例:
    from app.models.api_key import ApiKey, ApiKeyType, ApiKeyStatus

    # 创建外部 Key
    key = ApiKey(
        key_prefix="sk-ext-",
        key_hash=compute_hmac(raw_key),
        key_hint=raw_key[-4:],
        type=ApiKeyType.EXTERNAL,
        status=ApiKeyStatus.ACTIVE,
        name="Production API Key",
        tenant_id=tenant_uuid,
        created_by=admin_uuid,
    )
"""
import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    UUID as SA_UUID,
)
from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .provider_preset import JSONBCompat

# ============================================================
# 枚举定义
# ============================================================

class ApiKeyType(str, enum.Enum):
    """API Key 类型"""
    INTERNAL = "internal"  # 内部服务/前端
    EXTERNAL = "external"  # 外部租户


class ApiKeyStatus(str, enum.Enum):
    """API Key 状态"""
    ACTIVE = "active"       # 正常使用
    EXPIRING = "expiring"   # 即将过期（轮换期间）
    REVOKED = "revoked"     # 已吊销
    EXPIRED = "expired"     # 已过期


class ScopeType(str, enum.Enum):
    """权限范围类型"""
    CAPABILITY = "capability"  # 能力级别 (chat, embedding, image_generation)
    MODEL = "model"            # 模型级别 (gpt-4, claude-3)
    ENDPOINT = "endpoint"      # 端点级别 (/v1/chat/completions)


class ScopePermission(str, enum.Enum):
    """权限类型"""
    ALLOW = "allow"  # 白名单
    DENY = "deny"    # 黑名单


class QuotaType(str, enum.Enum):
    """配额类型"""
    TOKEN = "token"      # Token 配额
    REQUEST = "request"  # 请求数配额
    COST = "cost"        # 费用配额


class QuotaResetPeriod(str, enum.Enum):
    """配额重置周期"""
    DAILY = "daily"      # 每日重置
    MONTHLY = "monthly"  # 每月重置
    NEVER = "never"      # 永不重置（一次性配额）


# ============================================================
# 数据模型
# ============================================================

class ApiKey(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    API Key 主表

    安全存储:
    - key_hash: HMAC-SHA256(raw_key, SECRET_KEY)
    - key_hint: 末 4 位，便于用户辨识
    - key_prefix: 类型前缀 (sk-ext- / sk-int-)

    关联关系:
    - scopes: 权限范围列表
    - rate_limit: 限流配置（一对一）
    - quotas: 配额列表
    - ip_whitelist: IP 白名单列表
    """
    __tablename__ = "api_key"
    __table_args__ = (
        Index("ix_api_key_key_hash", "key_hash"),
        Index("ix_api_key_tenant_id", "tenant_id"),
        Index("ix_api_key_user_id", "user_id"),
        Index("ix_api_key_status", "status"),
    )

    # Key 标识
    key_prefix: Mapped[str] = mapped_column(
        String(12), nullable=False,
        comment="Key 前缀 (sk-ext- / sk-int-)"
    )
    key_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True,
        comment="HMAC-SHA256 哈希"
    )
    key_hint: Mapped[str] = mapped_column(
        String(8), nullable=False,
        comment="Key 末 4 位 (****abcd)"
    )
    secret_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True,
        comment="HMAC 签名专用 Secret 哈希 (独立于 key_hash)"
    )
    secret_hint: Mapped[str | None] = mapped_column(
        String(8), nullable=True,
        comment="Secret 末 4 位 (****wxyz)"
    )

    # 类型与状态
    type: Mapped[ApiKeyType] = mapped_column(
        SAEnum(ApiKeyType, native_enum=False, length=20),
        nullable=False,
        comment="Key 类型: internal/external"
    )
    status: Mapped[ApiKeyStatus] = mapped_column(
        SAEnum(ApiKeyStatus, native_enum=False, length=20),
        nullable=False, default=ApiKeyStatus.ACTIVE,
    comment="Key 状态"
)

# 基本信息
    name: Mapped[str] = mapped_column(
        String(100), nullable=False,
        comment="Key 名称/描述"
    )
    description: Mapped[str | None] = mapped_column(
        Text, nullable=True,
        comment="详细描述"
    )

    # 扩展能力（用户态创建）
    allowed_models: Mapped[list[str] | None] = mapped_column(
        JSONBCompat, nullable=True, default=list, server_default="[]",
        comment="允许的模型列表，空表示不限制"
    )
    allowed_ips: Mapped[list[str] | None] = mapped_column(
        JSONBCompat, nullable=True, default=list, server_default="[]",
        comment="IP 白名单，空表示不限制"
    )
    budget_limit: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 4), nullable=True, comment="预算上限（USD），空表示不限额"
    )
    budget_used: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=0, server_default="0",
        comment="已用预算（USD）"
    )
    rate_limit_rpm: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="每分钟请求数限制"
    )
    enable_logging: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
        comment="是否启用请求日志"
    )

    # 绑定关系
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True), nullable=True,
        comment="外部 Key 绑定的租户 ID"
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
        comment="内部 Key 绑定的用户/服务账号 ID"
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=False,
        comment="创建人 ID"
    )

    # 时间相关
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
        comment="过期时间 (NULL = 永不过期)"
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
        comment="最近使用时间"
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
        comment="吊销时间"
    )
    revoked_reason: Mapped[str | None] = mapped_column(
        String(255), nullable=True,
        comment="吊销原因"
    )

    # 关联关系
    scopes: Mapped[list["ApiKeyScope"]] = relationship(
        "ApiKeyScope",
        back_populates="api_key",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    rate_limit: Mapped[Optional["ApiKeyRateLimit"]] = relationship(
        "ApiKeyRateLimit",
        back_populates="api_key",
        cascade="all, delete-orphan",
        uselist=False,
        lazy="selectin",
    )
    quotas: Mapped[list["ApiKeyQuota"]] = relationship(
        "ApiKeyQuota",
        back_populates="api_key",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    ip_whitelist: Mapped[list["ApiKeyIpWhitelist"]] = relationship(
        "ApiKeyIpWhitelist",
        back_populates="api_key",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<ApiKey(name={self.name}, type={self.type}, hint=****{self.key_hint})>"


class ApiKeyScope(Base, UUIDPrimaryKeyMixin):
    """
    API Key 权限范围表

    支持三种范围类型:
    - capability: 能力级别 (chat, embedding, image_generation)
    - model: 模型级别 (gpt-4, claude-3-opus)
    - endpoint: 端点级别 (/v1/chat/completions)

    支持黑白名单:
    - allow: 允许访问
    - deny: 禁止访问 (优先级更高)
    """
    __tablename__ = "api_key_scope"
    __table_args__ = (
        UniqueConstraint("api_key_id", "scope_type", "scope_value", name="uq_api_key_scope"),
    )

    api_key_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("api_key.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联 api_key.id"
    )
    scope_type: Mapped[ScopeType] = mapped_column(
        SAEnum(ScopeType, native_enum=False, length=20),
        nullable=False,
        comment="范围类型"
    )
    scope_value: Mapped[str] = mapped_column(
        String(100), nullable=False,
        comment="具体值 (chat, gpt-4, /v1/chat/completions)"
    )
    permission: Mapped[ScopePermission] = mapped_column(
        SAEnum(ScopePermission, native_enum=False, length=10),
        nullable=False, default=ScopePermission.ALLOW,
        comment="权限类型: allow/deny"
    )

    # 关联
    api_key: Mapped["ApiKey"] = relationship("ApiKey", back_populates="scopes")

    def __repr__(self) -> str:
        return f"<ApiKeyScope({self.scope_type}:{self.scope_value}={self.permission})>"


class ApiKeyRateLimit(Base, UUIDPrimaryKeyMixin):
    """
    API Key 限流配置表

    限流维度:
    - rpm: 每分钟请求数
    - tpm: 每分钟 Token 数
    - rpd: 每日请求数
    - tpd: 每日 Token 数
    - concurrent_limit: 并发请求数
    - burst_limit: 突发上限

    NULL 表示无限制，使用全局默认值
    """
    __tablename__ = "api_key_rate_limit"

    api_key_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("api_key.id", ondelete="CASCADE"),
        nullable=False, unique=True,
        comment="关联 api_key.id"
    )

    # 每分钟限制
    rpm: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
        comment="每分钟请求数限制"
    )
    tpm: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
        comment="每分钟 Token 数限制"
    )

    # 每日限制
    rpd: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
        comment="每日请求数限制"
    )
    tpd: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
        comment="每日 Token 数限制"
    )

    # 并发与突发
    concurrent_limit: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
        comment="并发请求数限制"
    )
    burst_limit: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
        comment="突发上限"
    )

    # 白名单
    is_whitelist: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False,
        comment="是否白名单 (跳过全局限流)"
    )

    # 关联
    api_key: Mapped["ApiKey"] = relationship("ApiKey", back_populates="rate_limit")

    def __repr__(self) -> str:
        return f"<ApiKeyRateLimit(rpm={self.rpm}, tpm={self.tpm})>"


class ApiKeyQuota(Base, UUIDPrimaryKeyMixin):
    """
    API Key 配额表

    配额类型:
    - token: Token 配额
    - request: 请求数配额
    - cost: 费用配额

    重置周期:
    - daily: 每日重置
    - monthly: 每月重置
    - never: 永不重置（一次性配额）
    """
    __tablename__ = "api_key_quota"
    __table_args__ = (
        UniqueConstraint("api_key_id", "quota_type", name="uq_api_key_quota"),
    )

    api_key_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("api_key.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联 api_key.id"
    )
    quota_type: Mapped[QuotaType] = mapped_column(
        SAEnum(QuotaType, native_enum=False, length=20),
        nullable=False,
        comment="配额类型"
    )

    # 配额值
    total_quota: Mapped[int] = mapped_column(
        BigInteger, nullable=False,
        comment="总配额"
    )
    used_quota: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0,
        comment="已用配额"
    )

    # 重置
    reset_period: Mapped[QuotaResetPeriod] = mapped_column(
        SAEnum(QuotaResetPeriod, native_enum=False, length=20),
        nullable=False, default=QuotaResetPeriod.MONTHLY,
        comment="重置周期"
    )
    reset_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
        comment="下次重置时间"
    )

    # 关联
    api_key: Mapped["ApiKey"] = relationship("ApiKey", back_populates="quotas")

    @property
    def remaining(self) -> int:
        """剩余配额"""
        return max(0, self.total_quota - self.used_quota)

    @property
    def is_exhausted(self) -> bool:
        """配额是否用尽"""
        return self.used_quota >= self.total_quota

    def __repr__(self) -> str:
        return f"<ApiKeyQuota({self.quota_type}: {self.used_quota}/{self.total_quota})>"


class ApiKeyIpWhitelist(Base, UUIDPrimaryKeyMixin):
    """
    API Key IP 白名单表

    支持:
    - 单个 IP: 192.168.1.100
    - CIDR 段: 192.168.1.0/24
    - IPv6: 2001:db8::/32
    """
    __tablename__ = "api_key_ip_whitelist"
    __table_args__ = (
        UniqueConstraint("api_key_id", "ip_pattern", name="uq_api_key_ip"),
    )

    api_key_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("api_key.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联 api_key.id"
    )
    ip_pattern: Mapped[str] = mapped_column(
        String(50), nullable=False,
        comment="IP 或 CIDR (192.168.1.0/24)"
    )
    description: Mapped[str | None] = mapped_column(
        String(100), nullable=True,
        comment="描述"
    )

    # 关联
    api_key: Mapped["ApiKey"] = relationship("ApiKey", back_populates="ip_whitelist")

    def __repr__(self) -> str:
        return f"<ApiKeyIpWhitelist({self.ip_pattern})>"


class ApiKeyUsage(Base):
    """
    API Key 使用统计表

    按小时聚合统计:
    - 请求数
    - Token 消耗
    - 费用
    - 错误数

    注: 生产环境可考虑写入时序数据库 (InfluxDB/TimescaleDB)
    """
    __tablename__ = "api_key_usage"
    __table_args__ = (
        UniqueConstraint("api_key_id", "stat_date", "stat_hour", name="uq_api_key_usage"),
        Index("ix_api_key_usage_date", "stat_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    api_key_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("api_key.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联 api_key.id"
    )
    stat_date: Mapped[datetime] = mapped_column(
        Date, nullable=False,
        comment="统计日期"
    )
    stat_hour: Mapped[int] = mapped_column(
        SmallInteger, nullable=False,
        comment="统计小时 (0-23)"
    )

    # 统计值
    request_count: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0,
        comment="请求数"
    )
    token_count: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0,
        comment="Token 消耗"
    )
    cost: Mapped[Decimal] = mapped_column(
        Numeric(18, 8), nullable=False, default=Decimal("0"),
        comment="费用"
    )
    error_count: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0,
        comment="错误数"
    )

    def __repr__(self) -> str:
        return f"<ApiKeyUsage({self.stat_date} H{self.stat_hour}: {self.request_count} reqs)>"
