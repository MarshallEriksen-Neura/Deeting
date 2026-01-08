"""
API Key Pydantic Schema

用于 API 请求/响应的数据验证和序列化
"""
from datetime import datetime
from decimal import Decimal
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ============================================================
# 枚举
# ============================================================

class ApiKeyTypeEnum(str, Enum):
    INTERNAL = "internal"
    EXTERNAL = "external"


class ApiKeyStatusEnum(str, Enum):
    ACTIVE = "active"
    EXPIRING = "expiring"
    REVOKED = "revoked"
    EXPIRED = "expired"


class ScopeTypeEnum(str, Enum):
    CAPABILITY = "capability"
    MODEL = "model"
    ENDPOINT = "endpoint"


class ScopePermissionEnum(str, Enum):
    ALLOW = "allow"
    DENY = "deny"


class QuotaTypeEnum(str, Enum):
    TOKEN = "token"
    REQUEST = "request"
    COST = "cost"


class QuotaResetPeriodEnum(str, Enum):
    DAILY = "daily"
    MONTHLY = "monthly"
    NEVER = "never"


# ============================================================
# Scope Schema
# ============================================================

class ApiKeyScopeBase(BaseModel):
    scope_type: ScopeTypeEnum = Field(..., description="范围类型")
    scope_value: str = Field(..., max_length=100, description="具体值")
    permission: ScopePermissionEnum = Field(ScopePermissionEnum.ALLOW, description="权限类型")


class ApiKeyScopeCreate(ApiKeyScopeBase):
    pass


class ApiKeyScopeRead(ApiKeyScopeBase):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


# ============================================================
# Rate Limit Schema
# ============================================================

class ApiKeyRateLimitBase(BaseModel):
    rpm: int | None = Field(None, ge=0, description="每分钟请求数限制")
    tpm: int | None = Field(None, ge=0, description="每分钟 Token 数限制")
    rpd: int | None = Field(None, ge=0, description="每日请求数限制")
    tpd: int | None = Field(None, ge=0, description="每日 Token 数限制")
    concurrent_limit: int | None = Field(None, ge=0, description="并发请求数限制")
    burst_limit: int | None = Field(None, ge=0, description="突发上限")
    is_whitelist: bool = Field(False, description="是否白名单")


class ApiKeyRateLimitCreate(ApiKeyRateLimitBase):
    pass


class ApiKeyRateLimitRead(ApiKeyRateLimitBase):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


# ============================================================
# Quota Schema
# ============================================================

class ApiKeyQuotaBase(BaseModel):
    quota_type: QuotaTypeEnum = Field(..., description="配额类型")
    total_quota: int = Field(..., ge=0, description="总配额")
    reset_period: QuotaResetPeriodEnum = Field(QuotaResetPeriodEnum.MONTHLY, description="重置周期")


class ApiKeyQuotaCreate(ApiKeyQuotaBase):
    pass


class ApiKeyQuotaRead(ApiKeyQuotaBase):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    used_quota: int = Field(0, description="已用配额")
    reset_at: datetime | None = Field(None, description="下次重置时间")


# ============================================================
# IP Whitelist Schema
# ============================================================

class ApiKeyIpWhitelistBase(BaseModel):
    ip_pattern: str = Field(..., max_length=50, description="IP 或 CIDR")
    description: str | None = Field(None, max_length=100, description="描述")


class ApiKeyIpWhitelistCreate(ApiKeyIpWhitelistBase):
    pass


class ApiKeyIpWhitelistRead(ApiKeyIpWhitelistBase):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


# ============================================================
# API Key Schema
# ============================================================

class ApiKeyBase(BaseModel):
    name: str = Field(..., max_length=100, description="Key 名称")
    description: str | None = Field(None, description="详细描述")
    type: ApiKeyTypeEnum = Field(..., description="Key 类型")
    tenant_id: UUID | None = Field(None, description="外部 Key 绑定的租户 ID")
    user_id: UUID | None = Field(None, description="内部 Key 绑定的用户 ID")
    expires_at: datetime | None = Field(None, description="过期时间")


class ApiKeyCreate(ApiKeyBase):
    """创建 API Key 请求"""
    scopes: list[ApiKeyScopeCreate] | None = Field(None, description="权限范围")
    rate_limit: ApiKeyRateLimitCreate | None = Field(None, description="限流配置")
    quotas: list[ApiKeyQuotaCreate] | None = Field(None, description="配额配置")
    ip_whitelist: list[str] | None = Field(None, description="IP 白名单")


class ApiKeyUpdate(BaseModel):
    """更新 API Key 请求"""
    name: str | None = Field(None, max_length=100, description="Key 名称")
    description: str | None = Field(None, description="详细描述")
    expires_at: datetime | None = Field(None, description="过期时间")


class ApiKeyRead(ApiKeyBase):
    """API Key 详情响应"""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    key_prefix: str = Field(..., description="Key 前缀")
    key_hint: str = Field(..., description="Key 末 4 位")
    status: ApiKeyStatusEnum = Field(..., description="状态")
    created_by: UUID = Field(..., description="创建人 ID")
    last_used_at: datetime | None = Field(None, description="最近使用时间")
    revoked_at: datetime | None = Field(None, description="吊销时间")
    revoked_reason: str | None = Field(None, description="吊销原因")
    created_at: datetime
    updated_at: datetime

    scopes: list[ApiKeyScopeRead] = Field(default_factory=list)
    rate_limit: ApiKeyRateLimitRead | None = None
    quotas: list[ApiKeyQuotaRead] = Field(default_factory=list)
    ip_whitelist: list[ApiKeyIpWhitelistRead] = Field(default_factory=list)


class ApiKeyCreatedResponse(BaseModel):
    """创建 API Key 响应（包含完整 Key，仅此一次可见）"""
    api_key: ApiKeyRead
    raw_key: str = Field(..., description="完整 API Key（仅此一次可见，请妥善保管）")


class ApiKeyListResponse(BaseModel):
    """API Key 列表响应"""
    items: list[ApiKeyRead]
    total: int
    skip: int
    limit: int


# ============================================================
# 操作请求 Schema
# ============================================================

class ApiKeyRevokeRequest(BaseModel):
    """吊销 API Key 请求"""
    reason: str = Field(..., max_length=255, description="吊销原因")


class ApiKeyRotateResponse(BaseModel):
    """轮换 API Key 响应"""
    new_key: ApiKeyRead
    raw_key: str = Field(..., description="新的完整 API Key")
    old_key_expires_at: datetime = Field(..., description="旧 Key 过期时间")


# ============================================================
# Usage 统计 Schema
# ============================================================

class ApiKeyUsageRead(BaseModel):
    """API Key 使用统计"""
    model_config = ConfigDict(from_attributes=True)

    stat_date: datetime
    stat_hour: int
    request_count: int
    token_count: int
    cost: Decimal
    error_count: int


class ApiKeyUsageStatsResponse(BaseModel):
    """使用统计响应"""
    api_key_id: UUID
    start_date: datetime
    end_date: datetime
    total_requests: int
    total_tokens: int
    total_cost: Decimal
    total_errors: int
    hourly_stats: list[ApiKeyUsageRead]
