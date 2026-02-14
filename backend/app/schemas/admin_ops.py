from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema


class OffsetPageMeta(BaseSchema):
    total: int
    skip: int
    limit: int


class ConversationAdminItem(BaseSchema):
    id: UUID
    title: str | None = None
    user_id: UUID | None = None
    assistant_id: UUID | None = None
    channel: str
    status: str
    message_count: int = 0
    first_message_at: datetime | None = None
    last_active_at: datetime | None = None
    last_summary_version: int = 0
    created_at: datetime
    updated_at: datetime


class ConversationAdminListResponse(OffsetPageMeta):
    items: list[ConversationAdminItem]


class ConversationMessageAdminItem(BaseSchema):
    id: UUID
    session_id: UUID
    turn_index: int
    role: str
    content: str | None = None
    name: str | None = None
    token_estimate: int = 0
    meta_info: dict[str, Any] | None = None
    used_persona_id: UUID | None = None
    is_deleted: bool = False
    parent_message_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class ConversationMessageAdminListResponse(OffsetPageMeta):
    items: list[ConversationMessageAdminItem]


class ConversationSummaryAdminItem(BaseSchema):
    id: UUID
    session_id: UUID
    version: int
    summary_text: str
    covered_from_turn: int
    covered_to_turn: int
    token_estimate: int = 0
    summarizer_model: str | None = None
    created_at: datetime
    updated_at: datetime


class ConversationSummaryAdminListResponse(BaseSchema):
    items: list[ConversationSummaryAdminItem]


class SpecPlanAdminItem(BaseSchema):
    id: UUID
    user_id: UUID
    conversation_session_id: UUID | None = None
    project_name: str
    status: str
    version: int
    priority: int
    execution_config: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class SpecPlanAdminListResponse(OffsetPageMeta):
    items: list[SpecPlanAdminItem]


class SpecExecutionLogAdminItem(BaseSchema):
    id: UUID
    plan_id: UUID
    node_id: str
    status: str
    worker_info: str | None = None
    input_snapshot: dict[str, Any] | None = None
    output_data: dict[str, Any] | None = None
    raw_response: Any | None = None
    error_message: str | None = None
    retry_count: int = 0
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SpecExecutionLogAdminListResponse(OffsetPageMeta):
    items: list[SpecExecutionLogAdminItem]


class SpecWorkerSessionAdminItem(BaseSchema):
    id: UUID
    log_id: UUID
    internal_messages: list[dict[str, Any]] = Field(default_factory=list)
    thought_trace: list[dict[str, Any]] = Field(default_factory=list)
    total_tokens: int = 0
    created_at: datetime
    updated_at: datetime


class SpecWorkerSessionAdminListResponse(BaseSchema):
    items: list[SpecWorkerSessionAdminItem]


class GenerationTaskAdminItem(BaseSchema):
    id: UUID
    task_type: str
    model: str
    user_id: UUID | None = None
    status: str
    prompt_raw: str
    width: int | None = None
    height: int | None = None
    cost_upstream: float = 0
    cost_user: float = 0
    input_tokens: int = 0
    output_tokens: int = 0
    media_tokens: int = 0
    error_code: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class GenerationTaskAdminListResponse(OffsetPageMeta):
    items: list[GenerationTaskAdminItem]


class GenerationOutputAdminItem(BaseSchema):
    id: UUID
    task_id: UUID
    output_index: int
    media_asset_id: UUID | None = None
    source_url: str | None = None
    content_type: str | None = None
    size_bytes: int | None = None
    width: int | None = None
    height: int | None = None
    created_at: datetime
    updated_at: datetime


class GenerationOutputAdminListResponse(BaseSchema):
    items: list[GenerationOutputAdminItem]


class GenerationShareAdminItem(BaseSchema):
    id: UUID
    task_id: UUID
    user_id: UUID
    model: str
    prompt: str | None = None
    is_active: bool
    shared_at: datetime
    revoked_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class GenerationShareAdminListResponse(OffsetPageMeta):
    items: list[GenerationShareAdminItem]


class GenerationShareUpdateRequest(BaseSchema):
    is_active: bool


class TenantQuotaAdminItem(BaseSchema):
    id: UUID
    tenant_id: UUID
    balance: float
    credit_limit: float
    daily_quota: int
    daily_used: int
    monthly_quota: int
    monthly_used: int
    rpm_limit: int
    tpm_limit: int
    token_quota: int
    token_used: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TenantQuotaAdminListResponse(OffsetPageMeta):
    items: list[TenantQuotaAdminItem]


class TenantQuotaUpdateRequest(BaseSchema):
    credit_limit: float | None = None
    daily_quota: int | None = Field(default=None, ge=0)
    monthly_quota: int | None = Field(default=None, ge=0)
    rpm_limit: int | None = Field(default=None, ge=1)
    tpm_limit: int | None = Field(default=None, ge=1)
    token_quota: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class TenantQuotaAdjustRequest(BaseSchema):
    amount: float = Field(..., description="正数充值，负数扣减")
    reason: str | None = None


class BillingTransactionAdminItem(BaseSchema):
    id: UUID
    tenant_id: UUID
    api_key_id: UUID | None = None
    trace_id: str
    type: str
    status: str
    amount: float
    input_tokens: int = 0
    output_tokens: int = 0
    model: str | None = None
    provider: str | None = None
    balance_before: float
    balance_after: float
    description: str | None = None
    created_at: datetime
    updated_at: datetime


class BillingTransactionAdminListResponse(OffsetPageMeta):
    items: list[BillingTransactionAdminItem]


class BillingSummaryResponse(BaseSchema):
    start_time: datetime
    end_time: datetime
    income: float
    refunds: float
    cost: float
    profit: float
    transaction_count: int


class GatewayLogAdminItem(BaseSchema):
    id: UUID
    trace_id: str | None = None
    user_id: UUID | None = None
    api_key_id: UUID | None = None
    preset_id: UUID | None = None
    model: str
    status_code: int
    duration_ms: int
    ttft_ms: int | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_upstream: float = 0
    cost_user: float = 0
    is_cached: bool
    error_code: str | None = None
    upstream_url: str | None = None
    retry_count: int = 0
    meta: dict[str, Any] | None = None
    created_at: datetime


class GatewayLogAdminListResponse(OffsetPageMeta):
    items: list[GatewayLogAdminItem]


class GatewayLogStatsBucket(BaseSchema):
    key: str
    count: int


class GatewayLogStatsResponse(BaseSchema):
    total: int
    success_rate: float
    cache_hit_rate: float
    error_distribution: list[GatewayLogStatsBucket]
    model_ranking: list[GatewayLogStatsBucket]
    latency_histogram: list[GatewayLogStatsBucket]


class KnowledgeArtifactAdminItem(BaseSchema):
    id: UUID
    title: str | None = None
    source_url: str
    artifact_type: str
    status: str
    embedding_model: str | None = None
    content_hash: str
    chunk_count: int = 0
    created_at: datetime
    updated_at: datetime


class KnowledgeArtifactAdminListResponse(OffsetPageMeta):
    items: list[KnowledgeArtifactAdminItem]


class PluginAdminItem(BaseSchema):
    id: str
    name: str
    version: str | None = None
    description: str = ""
    author: str | None = None
    module: str
    class_name: str
    enabled_by_default: bool
    is_always_on: bool
    restricted: bool
    allowed_roles: list[str] = Field(default_factory=list)
    status: str
    tools: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)


class PluginAdminListResponse(BaseSchema):
    items: list[PluginAdminItem]


class PluginReloadResponse(BaseSchema):
    ok: bool
    plugin_id: str
    message: str
