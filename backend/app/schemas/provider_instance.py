from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProviderInstanceCreate(BaseModel):
    preset_slug: str = Field(..., description="引用的模板 slug")
    name: str = Field(..., description="实例名称")
    description: str | None = Field(default=None, description="实例描述")
    base_url: str = Field(..., description="基础 URL")
    icon: str | None = Field(default=None, description="图标引用，覆盖模板 icon")
    credentials_ref: str | None = Field(None, description="密钥引用 ID（仅支持 db:<uuid> 或已有别名），若提供 api_key 则自动生成")
    api_key: str | None = Field(None, description="上游 API Key (明文)，将自动存入 ProviderCredential")
    protocol: str | None = Field(None, description="协议类型 (openai/anthropic)，若为空则使用 Preset 默认")
    model_prefix: str | None = Field(None, description="模型 ID 映射前缀")
    auto_append_v1: bool | None = Field(None, description="OpenAI 协议是否自动补 /v1")
    resource_name: str | None = Field(None, description="Azure OpenAI 资源名")
    deployment_name: str | None = Field(None, description="Azure 部署名")
    api_version: str | None = Field(None, description="Azure API 版本，默认 2023-05-15")
    project_id: str | None = Field(None, description="Vertex 项目 ID")
    region: str | None = Field(None, description="Vertex 区域，如 us-central1")
    priority: int = Field(0, description="路由优先级")
    is_enabled: bool = Field(True, description="是否启用")

    @field_validator("api_key", "protocol", mode="before")
    @classmethod
    def _strip_optional(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class ProviderInstanceUpdate(BaseModel):
    name: str | None = Field(default=None, description="实例名称")
    description: str | None = Field(default=None, description="实例描述")
    base_url: str | None = Field(default=None, description="基础 URL")
    icon: str | None = Field(default=None, description="图标引用，覆盖模板 icon")
    credentials_ref: str | None = Field(default=None, description="密钥引用 ID（仅支持 db:<uuid> 或已有别名）")
    api_key: str | None = Field(default=None, description="更新默认上游 API Key (明文)，将自动存入 ProviderCredential")
    protocol: str | None = Field(default=None, description="协议类型 (openai/anthropic)")
    model_prefix: str | None = Field(default=None, description="模型 ID 映射前缀")
    auto_append_v1: bool | None = Field(default=None, description="OpenAI 协议是否自动补 /v1")
    resource_name: str | None = Field(default=None, description="Azure OpenAI 资源名")
    deployment_name: str | None = Field(default=None, description="Azure 部署名")
    api_version: str | None = Field(default=None, description="Azure API 版本")
    project_id: str | None = Field(default=None, description="Vertex 项目 ID")
    region: str | None = Field(default=None, description="Vertex 区域")
    priority: int | None = Field(default=None, description="路由优先级")
    is_enabled: bool | None = Field(default=None, description="是否启用")

    @field_validator("api_key", "protocol", mode="before")
    @classmethod
    def _strip_optional(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class ProviderInstanceResponse(BaseModel):
    id: UUID
    user_id: Optional[UUID] = None
    preset_slug: str
    name: str
    description: Optional[str] = None
    base_url: str
    protocol: str | None = None
    auto_append_v1: bool | None = None
    icon: Optional[str] = None
    priority: int
    is_enabled: bool
    created_at: datetime
    updated_at: datetime
    
    health_status: str | None = "unknown"
    latency_ms: int | None = 0
    sparkline: List[int] = Field(default_factory=list)
    model_count: int = 0
    has_credentials: bool | None = None

    model_config = ConfigDict(from_attributes=True)


class ProviderModelUpsert(BaseModel):
    capabilities: List[str] = Field(..., description="能力列表：chat/embedding等")
    model_id: str = Field(..., description="上游真实模型标识")
    unified_model_id: Optional[str] = Field(None, description="对外统一/别名模型标识，可为空")
    upstream_path: str = Field(..., description="相对路径")
    display_name: Optional[str] = None
    pricing_config: dict[str, Any] = Field(default_factory=dict)
    limit_config: dict[str, Any] = Field(default_factory=dict)
    tokenizer_config: dict[str, Any] = Field(default_factory=dict)
    routing_config: dict[str, Any] = Field(default_factory=dict)
    config_override: dict[str, Any] = Field(default_factory=dict, description="能力配置覆盖（Merge Patch）")
    source: str = Field("auto", description="auto/manual")
    extra_meta: dict[str, Any] = Field(default_factory=dict)
    weight: int = 100
    priority: int = 0
    is_active: bool = True


class ProviderModelsUpsertRequest(BaseModel):
    models: List[ProviderModelUpsert]


class ProviderModelsQuickAddRequest(BaseModel):
    """懒人模式：仅提供模型名，后端自动填充默认配置。"""

    models: List[str] = Field(..., min_length=1, description="模型名称列表，支持批量")
    capability: str | None = Field(default=None, description="可选：强制指定能力 chat/embedding 等，默认为自动猜测")


class ProviderModelUpdate(BaseModel):
    display_name: Optional[str] = None
    is_active: Optional[bool] = None
    capabilities: Optional[List[str]] = None
    weight: Optional[int] = None
    priority: Optional[int] = None
    pricing_config: Optional[dict[str, Any]] = None
    limit_config: Optional[dict[str, Any]] = None
    tokenizer_config: Optional[dict[str, Any]] = None
    routing_config: Optional[dict[str, Any]] = None
    config_override: Optional[dict[str, Any]] = None


class ProviderModelResponse(BaseModel):
    id: UUID
    instance_id: UUID
    capabilities: List[str]
    model_id: str
    unified_model_id: Optional[str] = None
    display_name: Optional[str] = None
    upstream_path: str
    pricing_config: dict[str, Any]
    limit_config: dict[str, Any]
    tokenizer_config: dict[str, Any]
    routing_config: dict[str, Any]
    config_override: dict[str, Any]
    source: str
    extra_meta: dict[str, Any]
    weight: int
    priority: int
    is_active: bool
    synced_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ProviderModelTestRequest(BaseModel):
    prompt: str = Field("ping", description="用于探测的测试内容，默认 ping")


class ProviderModelTestResponse(BaseModel):
    success: bool
    latency_ms: int
    status_code: int
    upstream_url: str
    response_body: dict[str, Any] | None = None
    error: str | None = None


class ProviderVerifyRequest(BaseModel):
    preset_slug: str
    base_url: str
    api_key: str
    model: str | None = None
    protocol: str | None = "openai"
    auto_append_v1: bool | None = None
    resource_name: str | None = None
    deployment_name: str | None = None
    project_id: str | None = None
    region: str | None = None
    api_version: str | None = None


class ProviderVerifyResponse(BaseModel):
    success: bool
    message: str
    latency_ms: int = 0
    discovered_models: List[str] = Field(default_factory=list)
    probe_url: str | None = None
