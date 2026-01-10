from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProviderInstanceCreate(BaseModel):
    preset_slug: str = Field(..., description="引用的模板 slug")
    name: str = Field(..., description="实例名称")
    description: str | None = Field(default=None, description="实例描述")
    base_url: str = Field(..., description="基础 URL")
    icon: str | None = Field(default=None, description="图标引用，覆盖模板 icon")
    credentials_ref: str | None = Field(None, description="密钥引用 ID/环境变量名，若提供 api_key 则自动生成")
    api_key: str | None = Field(None, description="上游 API Key (明文)，将自动存入 ProviderCredential")
    protocol: str | None = Field(None, description="协议类型 (openai/anthropic)，若为空则使用 Preset 默认")
    model_prefix: str | None = Field(None, description="模型 ID 映射前缀")
    resource_name: str | None = Field(None, description="Azure OpenAI 资源名")
    deployment_name: str | None = Field(None, description="Azure 部署名")
    api_version: str | None = Field(None, description="Azure API 版本，默认 2023-05-15")
    project_id: str | None = Field(None, description="Vertex 项目 ID")
    region: str | None = Field(None, description="Vertex 区域，如 us-central1")
    channel: str = Field("external", description="internal/external/both")
    priority: int = Field(0, description="路由优先级")
    is_enabled: bool = Field(True, description="是否启用")


class ProviderInstanceResponse(BaseModel):
    id: UUID
    user_id: Optional[UUID] = None
    preset_slug: str
    name: str
    description: Optional[str] = None
    base_url: str
    icon: Optional[str] = None
    channel: str
    priority: int
    is_enabled: bool
    created_at: datetime
    updated_at: datetime
    
    health_status: str | None = "unknown"
    latency_ms: int | None = 0
    sparkline: List[int] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ProviderModelUpsert(BaseModel):
    capability: str = Field(..., description="能力：chat/embedding等")
    model_id: str = Field(..., description="上游真实模型标识")
    unified_model_id: Optional[str] = Field(None, description="对外统一/别名模型标识，可为空")
    upstream_path: str = Field(..., description="相对路径")
    display_name: Optional[str] = None
    template_engine: str = "simple_replace"
    request_template: dict[str, Any] = Field(default_factory=dict)
    response_transform: dict[str, Any] = Field(default_factory=dict)
    pricing_config: dict[str, Any] = Field(default_factory=dict)
    limit_config: dict[str, Any] = Field(default_factory=dict)
    tokenizer_config: dict[str, Any] = Field(default_factory=dict)
    routing_config: dict[str, Any] = Field(default_factory=dict)
    source: str = Field("auto", description="auto/manual")
    extra_meta: dict[str, Any] = Field(default_factory=dict)
    weight: int = 100
    priority: int = 0
    is_active: bool = True


class ProviderModelsUpsertRequest(BaseModel):
    models: List[ProviderModelUpsert]


class ProviderVerifyRequest(BaseModel):
    preset_slug: str
    base_url: str
    api_key: str
    model: str | None = None
    protocol: str | None = "openai"
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
