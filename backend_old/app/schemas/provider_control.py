from __future__ import annotations

import warnings
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from app.provider.sdk_selector import list_registered_sdk_vendors
from app.schemas.provider import SdkVendorValue

ApiStyleValue = Literal["openai", "responses", "claude"]

# ============================================================================
# Deprecation Constants (Phase 4: 能力映射迁移)
# ============================================================================

_SDK_VENDOR_DEPRECATION_MSG = (
    "sdk_vendor 已废弃，将在未来版本移除。"
    "请使用 provider_preset.metadata_json.capabilities[cap].adapter 指定适配器。"
)

_API_STYLES_DEPRECATION_MSG = (
    "supported_api_styles 已废弃，将在未来版本移除。"
    "请使用 provider_preset.metadata_json.capabilities 配置能力端点。"
)


def _validate_sdk_vendor_value(value: str | None) -> str | None:
    if value is None:
        return None
    # 发出废弃警告
    warnings.warn(_SDK_VENDOR_DEPRECATION_MSG, DeprecationWarning, stacklevel=3)
    supported = list_registered_sdk_vendors()
    if supported and value not in supported:
        raise ValueError(f"sdk_vendor 不在已注册列表中: {', '.join(supported)}")
    return value


class UserProviderCreateRequest(BaseModel):
    """创建用户私有提供商的请求模型。"""

    preset_id: str | None = Field(default=None, description="可选的官方预设 ID")
    name: str | None = Field(default=None, min_length=1, max_length=100, description="展示用名称")
    base_url: HttpUrl | None = Field(default=None, description="上游 API 的 base URL")
    api_key: str = Field(..., min_length=1, description="上游厂商 API Key，将以加密形式存储")

    weight: float | None = Field(
        default=1.0,
        description="用于路由的基础权重",
        gt=0,
    )
    region: str | None = Field(default=None, description="可选区域标签")
    cost_input: float | None = Field(default=None, gt=0)
    cost_output: float | None = Field(default=None, gt=0)
    max_qps: int | None = Field(default=None, gt=0)
    retryable_status_codes: list[int] | None = Field(default=None)
    custom_headers: dict[str, str] | None = Field(default=None)
    supported_api_styles: list[ApiStyleValue] | None = Field(
        default=None,
        deprecated=_API_STYLES_DEPRECATION_MSG,
    )
    static_models: list[dict[str, Any]] | None = Field(
        default=None,
        description="当上游不提供 /models 时可手动配置的模型列表",
    )

    @model_validator(mode="after")
    def ensure_required_fields(self) -> UserProviderCreateRequest:
        if self.preset_id:
            return self
        required = {
            "name": self.name,
            "base_url": self.base_url,
        }
        missing = [field for field, value in required.items() if value in (None, "")]
        if missing:
            raise ValueError("当未指定 preset_id 时，name/base_url 均为必填")
        return self


    @model_validator(mode="after")
    def validate_paths(self) -> UserProviderCreateRequest:
        # 路径配置改由 provider_preset / metadata 承载，表单不再验证路径
        return self


class UserQuotaResponse(BaseModel):
    """用户私有 Provider 配额信息。"""

    private_provider_limit: int = Field(
        ...,
        ge=0,
        description="当前用户可创建的私有 Provider 数量上限（用于展示）；对无限制用户为推荐展示值。",
    )
    private_provider_count: int = Field(
        ...,
        ge=0,
        description="当前用户已创建的私有 Provider 数量。",
    )
    is_unlimited: bool = Field(
        ...,
        description="是否在后端层面对用户的私有 Provider 数量不做硬性限制。",
    )


class UserProviderUpdateRequest(BaseModel):
    """更新用户私有提供商的请求模型。"""

    name: str | None = Field(default=None, max_length=100)
    base_url: HttpUrl | None = None
    weight: float | None = Field(default=None, gt=0)
    region: str | None = None
    cost_input: float | None = Field(default=None, gt=0)
    cost_output: float | None = Field(default=None, gt=0)
    max_qps: int | None = Field(default=None, gt=0)
    retryable_status_codes: list[int] | None = None
    custom_headers: dict[str, str] | None = None
    supported_api_styles: list[ApiStyleValue] | None = Field(
        default=None,
        deprecated=_API_STYLES_DEPRECATION_MSG,
    )
    static_models: list[dict[str, Any]] | None = None

    @model_validator(mode="after")
    def ensure_any_field(self) -> UserProviderUpdateRequest:
        if all(
            getattr(self, field) is None
            for field in (
                "name",
                "base_url",
               
                "weight",
                "region",
                "cost_input",
                "cost_output",
                "max_qps",
                "retryable_status_codes",
                "custom_headers",
                "supported_api_styles",
                "static_models",
            )
        ):
            raise ValueError("至少需要提供一个可更新字段")
        return self



class UserProviderResponse(BaseModel):
    """用户私有提供商的响应模型。"""

    id: UUID
    provider_id: str
    name: str
    base_url: HttpUrl
  
    preset_id: str | None = None
    visibility: str
    owner_id: UUID | None
    status: str
    created_at: datetime
    updated_at: datetime


    # 其他配置
    weight: float | None = None
    region: str | None = None
    max_qps: int | None = None
    cost_input: float | None = None
    cost_output: float | None = None
    retryable_status_codes: list[int] | None = None
    custom_headers: dict[str, str] | None = None
    static_models: list[dict] | None = None
    supported_api_styles: list[str] | None = None

    shared_user_ids: list[UUID] | None = Field(
        default=None,
        description="被授权使用该提供商的用户 ID 列表（仅所有者/管理员可见）",
    )

    model_config = ConfigDict(from_attributes=True)


class ProviderSharedUsersUpdateRequest(BaseModel):
    """更新 Provider 私有分享列表的请求模型。"""

    user_ids: list[UUID] = Field(
        default_factory=list,
        description="允许使用该 Provider 的用户 ID 列表，留空则仅所有者可用",
    )

    @model_validator(mode="after")
    def deduplicate(self) -> ProviderSharedUsersUpdateRequest:
        # 保持顺序不重要，去重即可
        self.user_ids = list(dict.fromkeys(self.user_ids))
        return self


class ProviderSharedUsersResponse(BaseModel):
    provider_id: str
    visibility: str
    shared_user_ids: list[UUID]

    model_config = ConfigDict(from_attributes=True)


class ProviderSubmissionRequest(BaseModel):
    """用户提交共享池提供商的请求模型。"""

    name: str = Field(..., max_length=100)
    provider_id: str = Field(..., max_length=50)
    base_url: HttpUrl
    api_key: str = Field(..., min_length=1, description="上游厂商 API Key")
    description: str | None = Field(default=None, max_length=2000)
    extra_config: dict[str, Any] | None = Field(
        default=None,
        description="可选的扩展配置，例如自定义 header、模型路径等",
    )


class ProviderSubmissionResponse(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    provider_id: str
    base_url: HttpUrl
    provider_type: str
    description: str | None
    approval_status: str
    reviewed_by: UUID | None
    review_notes: str | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProviderReviewRequest(BaseModel):
    """管理员审核共享提供商的请求模型。"""

    approved: bool | None = Field(default=None, description="是否通过该提交（兼容字段）")
    decision: Literal["approved", "approved_limited", "rejected"] | None = Field(
        default=None, description="新版审核决策，可覆盖 approved 字段"
    )
    limit_qps: int | None = Field(
        default=None,
        gt=0,
        description="当 decision=approved_limited 时的限速配置",
    )
    review_notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def ensure_decision(self) -> ProviderReviewRequest:
        if self.decision is None and self.approved is None:
            raise ValueError("必须提供 approved 或 decision")
        return self


class ProviderValidationResult(BaseModel):
    """提供商配置验证结果。"""

    is_valid: bool
    error_message: str | None = None
    metadata: dict[str, Any] | None = None


class ProviderTestRequest(BaseModel):
    """触发 Provider 探针/审核测试的请求体。"""

    mode: Literal["auto", "custom", "cron"] = Field(
        default="auto", description="测试模式：自动探针/自定义输入/巡检"
    )
    remark: str | None = Field(default=None, max_length=2000)
    input_text: str | None = Field(default=None, max_length=4000)


class ProviderTestResult(BaseModel):
    """测试记录的标准化响应结构。"""

    id: UUID
    provider_id: str
    mode: str
    success: bool
    summary: str | None = None
    probe_results: Any | None = None
    latency_ms: int | None = None
    error_code: str | None = None
    cost: float | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProviderModelValidationResult(BaseModel):
    model_id: str
    success: bool
    latency_ms: int | None = None
    error_message: str | None = None
    timestamp: datetime


class ProviderAuditActionRequest(BaseModel):
    """审核/运营状态更新请求。"""

    remark: str | None = Field(default=None, max_length=2000)
    limit_qps: int | None = Field(
        default=None,
        gt=0,
        description="审核限速通过时可选的 QPS 限制",
    )


class ProviderAuditLogResponse(BaseModel):
    """审核/运营日志响应。"""

    id: UUID
    provider_id: str
    action: str
    from_status: str | None = None
    to_status: str | None = None
    operation_from_status: str | None = None
    operation_to_status: str | None = None
    operator_id: UUID | None = None
    remark: str | None = None
    test_record_id: UUID | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProviderProbeConfigUpdate(BaseModel):
    probe_enabled: bool | None = Field(default=None, description="是否开启自动探针")
    probe_interval_seconds: int | None = Field(default=None, ge=60, description="探针间隔（秒）")
    probe_model: str | None = Field(default=None, max_length=100, description="探针使用的模型 ID，可选")


class UserPermissionResponse(BaseModel):
    id: UUID
    user_id: UUID
    permission_type: str
    permission_value: str | None
    expires_at: datetime | None
    notes: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserPermissionGrantRequest(BaseModel):
    permission_type: str = Field(..., max_length=32)
    permission_value: str | None = Field(default=None, max_length=100)
    expires_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=2000)


class AdminProviderResponse(BaseModel):
    """管理员视角的 Provider 信息。"""

    id: UUID
    provider_id: str
    name: str
    base_url: HttpUrl
    preset_id: str | None = None
    visibility: str
    owner_id: UUID | None
    status: str
    audit_status: str
    operation_status: str
    latest_test_result: ProviderTestResult | None = None
    probe_enabled: bool | None = None
    probe_interval_seconds: int | None = None
    probe_model: str | None = None
    last_check: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminProvidersResponse(BaseModel):
    providers: list[AdminProviderResponse]
    total: int


class ProviderVisibilityUpdateRequest(BaseModel):
    visibility: Literal["public", "restricted", "private"]


class ProviderPresetBase(BaseModel):
    preset_id: str = Field(..., min_length=1, max_length=50, description="官方预设 ID")
    display_name: str = Field(..., max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    base_url: HttpUrl
    models_path: str | None = Field(default=None)
    messages_path: str | None = Field(default=None)
    chat_completions_path: str | None = Field(default=None)
    responses_path: str | None = Field(default=None)
    images_generations_path: str | None = Field(default=None)
    supported_api_styles: list[ApiStyleValue] | None = Field(
        default=None,
        deprecated=_API_STYLES_DEPRECATION_MSG,
    )
    retryable_status_codes: list[int] | None = Field(default=None)
    custom_headers: dict[str, str] | None = Field(default=None)
    static_models: list[dict[str, Any]] | None = Field(default=None)
    endpoints_config: dict[str, Any] | None = Field(
        default=None, description="能力映射/输入输出映射配置（与 ProviderMetadata 保持一致结构）"
    )
    model_list_config: dict[str, Any] | None = Field(
        default=None, description="/models 解析规则（与 ProviderMetadata 保持一致结构）"
    )
    response_maps: dict[str, Any] | None = Field(
        default=None, description="按能力的请求/响应映射（如 audio/video 的 url_extractor 等）"
    )

    @model_validator(mode="after")
    def ensure_paths(self) -> ProviderPresetBase:
        # 验证路径格式并规范化
        for field_name in (
            "models_path",
            "messages_path",
            "chat_completions_path",
            "responses_path",
            "images_generations_path",
        ):
            value = getattr(self, field_name)
            if value is None:
                continue
            trimmed = value.strip()
            if not trimmed:
                setattr(self, field_name, None)
                continue
            if not trimmed.startswith("/"):
                raise ValueError(f"{field_name} 必须以 / 开头")
            setattr(self, field_name, trimmed)

        return self



    model_config = ConfigDict(from_attributes=True)


class ProviderPresetCreateRequest(ProviderPresetBase):
    pass


class ProviderPresetUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    base_url: HttpUrl | None = None
   
    images_generations_path: str | None = None
    supported_api_styles: list[ApiStyleValue] | None = Field(
        default=None,
        deprecated=_API_STYLES_DEPRECATION_MSG,
    )
    retryable_status_codes: list[int] | None = None
    custom_headers: dict[str, str] | None = None
    static_models: list[dict[str, Any]] | None = None
    endpoints_config: dict[str, Any] | None = None
    model_list_config: dict[str, Any] | None = None
    response_maps: dict[str, Any] | None = None

    @model_validator(mode="after")
    def ensure_any_field(self) -> ProviderPresetUpdateRequest:
        if all(
            getattr(self, attr) is None
            for attr in (
                "display_name",
                "description",
                "base_url",
               
                "retryable_status_codes",
                "custom_headers",
                "static_models",
                "endpoints_config",
                "model_list_config",
                "response_maps",
            )
        ):
            raise ValueError("至少需要提供一个可更新字段")
        return self





class ProviderPresetResponse(ProviderPresetBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProviderPresetListResponse(BaseModel):
    items: list[ProviderPresetResponse]
    total: int


class ProviderPresetImportError(BaseModel):
    preset_id: str
    reason: str


class ProviderPresetImportResult(BaseModel):
    created: list[str] = Field(default_factory=list, description="成功创建的预设ID列表")
    updated: list[str] = Field(default_factory=list, description="成功覆盖更新的预设ID列表")
    skipped: list[str] = Field(default_factory=list, description="因已存在且未开启覆盖而跳过的预设ID列表")
    failed: list[ProviderPresetImportError] = Field(default_factory=list, description="导入失败的预设及原因")


class ProviderPresetImportRequest(BaseModel):
    presets: list[ProviderPresetBase] = Field(default_factory=list, min_length=1, description="要导入的预设列表")
    overwrite: bool = Field(
        default=False,
        description="是否覆盖已存在的同名预设；默认不覆盖，若为false则同名预设会被跳过",
    )


class ProviderPresetExportResponse(BaseModel):
    presets: list[ProviderPresetBase]
    total: int


class PermissionResponse(BaseModel):
    """权限定义信息。"""

    id: UUID
    code: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RoleResponse(BaseModel):
    """角色基础信息。"""

    id: UUID
    code: str
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RoleCreateRequest(BaseModel):
    code: str = Field(..., max_length=64, description="角色唯一编码")
    name: str = Field(..., max_length=100, description="角色名称")
    description: str | None = Field(
        default=None, max_length=2000, description="角色描述"
    )


class RoleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def ensure_any_field(self) -> RoleUpdateRequest:
        if self.name is None and self.description is None:
            raise ValueError("至少需要提供一个可更新字段")
        return self


class RolePermissionsResponse(BaseModel):
    role_id: UUID
    role_code: str
    permission_codes: list[str]


class RolePermissionsUpdateRequest(BaseModel):
    permission_codes: list[str] = Field(
        default_factory=list,
        description="要设置到该角色上的权限 code 列表（全量覆盖）",
    )


class UserRolesUpdateRequest(BaseModel):
    role_ids: list[UUID] = Field(
        default_factory=list,
        description="要设置给用户的角色 ID 列表（全量覆盖）",
    )


__all__ = [
    "AdminProviderResponse",
    "AdminProvidersResponse",
    "PermissionResponse",
    "ProviderAuditActionRequest",
    "ProviderAuditLogResponse",
    "ProviderPresetBase",
    "ProviderPresetCreateRequest",
    "ProviderPresetExportResponse",
    "ProviderPresetImportError",
    "ProviderPresetImportRequest",
    "ProviderPresetImportResult",
    "ProviderPresetListResponse",
    "ProviderPresetResponse",
    "ProviderPresetUpdateRequest",
    "ProviderProbeConfigUpdate",
    "ProviderReviewRequest",
    "ProviderSharedUsersResponse",
    "ProviderSharedUsersUpdateRequest",
    "ProviderSubmissionRequest",
    "ProviderSubmissionResponse",
    "ProviderTestRequest",
    "ProviderTestResult",
    "ProviderValidationResult",
    "ProviderVisibilityUpdateRequest",
    "RoleCreateRequest",
    "RolePermissionsResponse",
    "RolePermissionsUpdateRequest",
    "RoleResponse",
    "UserPermissionGrantRequest",
    "UserPermissionResponse",
    "UserProviderCreateRequest",
    "UserProviderResponse",
    "UserProviderUpdateRequest",
    "UserQuotaResponse",
    "UserRolesUpdateRequest",
]
