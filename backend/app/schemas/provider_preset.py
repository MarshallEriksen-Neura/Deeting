from typing import Any
from uuid import UUID

from pydantic import Field, field_validator

from .base import BaseSchema, IDSchema, TimestampSchema
from .gateway_fields import allowed_fields_for
from .pricing import LimitConfig, PricingConfig

# Enums or Constants can be defined here or imported
# visibility: private, public, shared
# auth_type: api_key, bearer, none

class ProviderPresetItemBase(BaseSchema):
    capability: str = Field(..., max_length=32, description="能力类型：chat, embedding, tts, vision 等")
    subtype: str | None = Field(None, max_length=32, description="可选子类型")

    model: str = Field(..., max_length=128, description="上游实际需要的模型标识")
    unified_model_id: str | None = Field(None, max_length=128, description="逻辑层统一模型 ID")

    upstream_path: str = Field(..., max_length=255, description="请求路径（相对 base_url）")
    channel: str = Field(
        "external",
        description="可用通道: internal / external / both",
        pattern="^(internal|external|both)$",
    )

    template_engine: str = Field("simple_replace", max_length=32, description="模板引擎类型: simple_replace / jinja2")

    request_template: dict[str, Any] = Field(default_factory=dict, description="请求体模板")
    response_transform: dict[str, Any] = Field(default_factory=dict, description="响应变换规则")

    pricing_config: PricingConfig = Field(default_factory=PricingConfig, description="计费配置")
    limit_config: LimitConfig = Field(default_factory=LimitConfig, description="限流配置")
    tokenizer_config: dict[str, Any] = Field(default_factory=dict, description="Tokenizer 配置")
    routing_config: dict[str, Any] = Field(
        default_factory=dict,
        description="路由策略配置（bandit/灰度/熔断）",
    )

    visibility: str = Field("private", max_length=16, description="可见性: private / public / shared")
    shared_scope: str | None = Field(None, max_length=32, description="共享作用域")
    shared_targets: list[str] = Field(default_factory=list, description="共享对象列表") # JSONB but design says list of IDs usually

    weight: int = Field(100, ge=0, description="负载分配权重")
    priority: int = Field(0, description="回退优先级")
    is_active: bool = Field(True, description="是否启用")

    @field_validator("capability")
    @classmethod
    def validate_capability(cls, v: str) -> str:
        """
        限定能力枚举，兼容历史 embedding/tts/vision，同时新增 image/audio/video。
        """
        allowed_caps = {"chat", "image", "audio", "video", "embedding", "tts", "vision"}
        if v not in allowed_caps:
            raise ValueError(f"不支持的 capability: {v}")
        return v

    @field_validator("request_template")
    @classmethod
    def validate_gateway_fields(cls, v, info):
        """
        当 request_template 提供 gateway_fields（列表）时，校验是否落在统一字段白名单内。
        """
        capability = info.data.get("capability")
        if not isinstance(v, dict):
            return v
        gateway_fields = v.get("gateway_fields")
        if not gateway_fields or not capability:
            return v

        allowed = allowed_fields_for(capability)
        unknown = [f for f in gateway_fields if f not in allowed]
        if unknown:
            raise ValueError(f"gateway_fields 包含未支持字段: {unknown}")
        return v

    @field_validator("pricing_config")
    @classmethod
    def validate_pricing_config(cls, v: PricingConfig, info):
        """
        根据 capability 校验计价配置是否齐备。
        """
        capability = info.data.get("capability")
        if capability:
            v.ensure_capability_pricing(capability)
        return v

class ProviderPresetItemCreate(ProviderPresetItemBase):
    pass

class ProviderPresetItemUpdate(BaseSchema):
    # All fields optional for update
    capability: str | None = Field(None, max_length=32)
    subtype: str | None = Field(None, max_length=32)
    model: str | None = Field(None, max_length=128)
    unified_model_id: str | None = Field(None, max_length=128)
    upstream_path: str | None = Field(None, max_length=255)
    channel: str | None = Field(
        None,
        pattern="^(internal|external|both)$",
        description="通道限制: internal / external / both",
    )
    template_engine: str | None = Field(None, max_length=32)
    request_template: dict[str, Any] | None = None
    response_transform: dict[str, Any] | None = None
    pricing_config: dict[str, Any] | None = None
    limit_config: dict[str, Any] | None = None
    tokenizer_config: dict[str, Any] | None = None
    routing_config: dict[str, Any] | None = None
    visibility: str | None = Field(None, max_length=16)
    shared_scope: str | None = Field(None, max_length=32)
    shared_targets: list[str] | None = None
    weight: int | None = Field(None, ge=0)
    priority: int | None = None
    is_active: bool | None = None

class ProviderPresetItemDTO(ProviderPresetItemBase, IDSchema, TimestampSchema):
    preset_id: UUID
    owner_user_id: UUID | None = None


class ProviderPresetBase(BaseSchema):
    name: str = Field(..., max_length=80, description="预设名称")
    slug: str = Field(..., max_length=80, description="机器可读标识")
    provider: str = Field(..., max_length=40, description="上游厂商/驱动名称")
    base_url: str = Field(..., max_length=255, description="上游基础 URL")

    auth_type: str = Field(..., max_length=20, description="认证方式: api_key, bearer, none")
    # auth_config 在 Base 中定义，但在 DTO 中可能需要脱敏
    auth_config: dict[str, Any] = Field(default_factory=dict, description="认证配置")

    default_headers: dict[str, Any] = Field(default_factory=dict, description="通用 Header 模板")
    default_params: dict[str, Any] = Field(default_factory=dict, description="通用请求体参数默认值")

    is_active: bool = Field(True, description="是否启用")

class ProviderPresetCreate(ProviderPresetBase):
    # 创建时允许直接包含 items
    items: list[ProviderPresetItemCreate] | None = None

class ProviderPresetUpdate(BaseSchema):
    name: str | None = Field(None, max_length=80)
    # slug 通常不允许频繁修改，或者需要特殊处理
    slug: str | None = Field(None, max_length=80)
    provider: str | None = Field(None, max_length=40)
    base_url: str | None = Field(None, max_length=255)
    auth_type: str | None = Field(None, max_length=20)
    auth_config: dict[str, Any] | None = None
    default_headers: dict[str, Any] | None = None
    default_params: dict[str, Any] | None = None
    is_active: bool | None = None
    version: int | None = Field(None, description="乐观锁版本号控制")

class ProviderPresetDTO(ProviderPresetBase, IDSchema, TimestampSchema):
    version: int
    items: list[ProviderPresetItemDTO] = Field(default_factory=list)

    @field_validator('auth_config')
    @classmethod
    def mask_auth_config(cls, v: dict[str, Any]) -> dict[str, Any]:
        """
        脱敏 auth_config
        简单的策略：如果包含 key/token 等关键词，替换为 ***
        实际生产中可能只返回 key_id 引用，或者完全不返回敏感值
        """
        if not v:
            return v
        masked = v.copy()
        sensitive_keys = {'key', 'token', 'secret', 'password', 'credential'}
        for k in masked:
            if any(s in k.lower() for s in sensitive_keys):
                masked[k] = "******"
        return masked
