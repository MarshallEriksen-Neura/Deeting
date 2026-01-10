"""
类型化 WorkflowContext 访问器

提供类型安全的上下文访问，避免字符串键的拼写错误和类型不匹配。

使用方式：
    from app.services.orchestrator.typed_context import TypedContext

    typed_ctx = TypedContext(ctx)
    tenant_id = typed_ctx.tenant_id  # 类型安全
    pricing = typed_ctx.routing.pricing_config  # 嵌套访问
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext


@dataclass
class ValidationData:
    """validation 步骤数据"""

    request: Any | None = None
    model: str | None = None
    messages: list | None = None
    stream: bool = False


@dataclass
class RoutingData:
    """routing 步骤数据"""

    provider: str | None = None
    provider_model_id: str | None = None
    preset_item_id: str | None = None
    upstream_url: str | None = None
    upstream_path: str | None = None
    pricing_config: dict | None = None
    limit_config: dict | None = None
    auth_config: dict | None = None
    tokenizer_config: dict | None = None


@dataclass
class QuotaCheckData:
    """quota_check 步骤数据"""

    remaining_balance: Decimal | None = None
    daily_remaining: int | None = None
    monthly_remaining: int | None = None
    credit_limit: Decimal | None = None


@dataclass
class UpstreamCallData:
    """upstream_call 步骤数据"""

    stream: bool = False
    response: Any | None = None
    status_code: int | None = None
    latency_ms: float | None = None
    provider: str | None = None
    model: str | None = None


@dataclass
class ResponseTransformData:
    """response_transform 步骤数据"""

    transformed_response: Any | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


@dataclass
class BillingData:
    """billing 步骤数据"""

    pending_transaction_id: str | None = None
    pending_trace_id: str | None = None
    pricing_config: dict | None = None
    total_cost: Decimal | None = None
    balance_after: Decimal | None = None
    skip_reason: str | None = None


@dataclass
class ExternalAuthData:
    """external_auth 步骤数据"""

    api_key_id: str | None = None
    tenant_id: str | None = None
    budget_limit: Decimal | None = None
    budget_used: Decimal | None = None
    scopes: list[str] | None = None


class TypedContext:
    """
    类型化的 WorkflowContext 访问器

    提供类型安全的上下文访问，避免字符串键的拼写错误。

    Example:
        typed_ctx = TypedContext(ctx)
        tenant_id = typed_ctx.tenant_id
        pricing = typed_ctx.routing.pricing_config
        input_tokens = typed_ctx.response_transform.input_tokens
    """

    def __init__(self, ctx: WorkflowContext):
        self._ctx = ctx

    # ===== 顶层属性 =====

    @property
    def trace_id(self) -> str:
        return self._ctx.trace_id

    @property
    def tenant_id(self) -> str | None:
        return self._ctx.tenant_id

    @property
    def api_key_id(self) -> str | None:
        return self._ctx.api_key_id

    @property
    def user_id(self) -> str | None:
        return self._ctx.user_id

    @property
    def is_external(self) -> bool:
        return self._ctx.is_external

    @property
    def requested_model(self) -> str | None:
        return self._ctx.requested_model

    # ===== 步骤数据访问器 =====

    @property
    def validation(self) -> ValidationData:
        """validation 步骤数据"""
        return ValidationData(
            request=self._ctx.get("validation", "request"),
            model=self._ctx.get("validation", "model"),
            messages=self._ctx.get("validation", "messages"),
            stream=self._ctx.get("validation", "stream", False),
        )

    @property
    def routing(self) -> RoutingData:
        """routing 步骤数据"""
        return RoutingData(
            provider=self._ctx.get("routing", "provider"),
            provider_model_id=self._ctx.get("routing", "provider_model_id"),
            preset_item_id=self._ctx.get("routing", "preset_item_id"),
            upstream_url=self._ctx.get("routing", "upstream_url"),
            upstream_path=self._ctx.get("routing", "upstream_path"),
            pricing_config=self._ctx.get("routing", "pricing_config"),
            limit_config=self._ctx.get("routing", "limit_config"),
            auth_config=self._ctx.get("routing", "auth_config"),
            tokenizer_config=self._ctx.get("routing", "tokenizer_config"),
        )

    @property
    def quota_check(self) -> QuotaCheckData:
        """quota_check 步骤数据"""
        return QuotaCheckData(
            remaining_balance=self._ctx.get("quota_check", "remaining_balance"),
            daily_remaining=self._ctx.get("quota_check", "daily_remaining"),
            monthly_remaining=self._ctx.get("quota_check", "monthly_remaining"),
            credit_limit=self._ctx.get("quota_check", "credit_limit"),
        )

    @property
    def upstream_call(self) -> UpstreamCallData:
        """upstream_call 步骤数据"""
        return UpstreamCallData(
            stream=self._ctx.get("upstream_call", "stream", False),
            response=self._ctx.get("upstream_call", "response"),
            status_code=self._ctx.get("upstream_call", "status_code"),
            latency_ms=self._ctx.get("upstream_call", "latency_ms"),
            provider=self._ctx.get("upstream_call", "provider"),
            model=self._ctx.get("upstream_call", "model"),
        )

    @property
    def response_transform(self) -> ResponseTransformData:
        """response_transform 步骤数据"""
        return ResponseTransformData(
            transformed_response=self._ctx.get("response_transform", "transformed_response"),
            input_tokens=self._ctx.get("response_transform", "input_tokens", 0),
            output_tokens=self._ctx.get("response_transform", "output_tokens", 0),
            total_tokens=self._ctx.get("response_transform", "total_tokens", 0),
        )

    @property
    def billing(self) -> BillingData:
        """billing 步骤数据"""
        return BillingData(
            pending_transaction_id=self._ctx.get("billing", "pending_transaction_id"),
            pending_trace_id=self._ctx.get("billing", "pending_trace_id"),
            pricing_config=self._ctx.get("billing", "pricing_config"),
            total_cost=self._ctx.get("billing", "total_cost"),
            balance_after=self._ctx.get("billing", "balance_after"),
            skip_reason=self._ctx.get("billing", "skip_reason"),
        )

    @property
    def external_auth(self) -> ExternalAuthData:
        """external_auth 步骤数据"""
        return ExternalAuthData(
            api_key_id=self._ctx.get("external_auth", "api_key_id"),
            tenant_id=self._ctx.get("external_auth", "tenant_id"),
            budget_limit=self._ctx.get("external_auth", "budget_limit"),
            budget_used=self._ctx.get("external_auth", "budget_used"),
            scopes=self._ctx.get("external_auth", "scopes"),
        )

    # ===== 便捷方法 =====

    def get_pricing_config(self) -> dict | None:
        """获取定价配置"""
        return self._ctx.get("routing", "pricing_config")

    def get_limit_config(self) -> dict | None:
        """获取限流配置"""
        return self._ctx.get("routing", "limit_config")

    def get_input_tokens(self) -> int:
        """获取输入 Token 数"""
        return self._ctx.get("response_transform", "input_tokens", 0)

    def get_output_tokens(self) -> int:
        """获取输出 Token 数"""
        return self._ctx.get("response_transform", "output_tokens", 0)

    def get_total_tokens(self) -> int:
        """获取总 Token 数"""
        return self._ctx.get("response_transform", "total_tokens", 0)

    def is_stream(self) -> bool:
        """是否为流式请求"""
        return self._ctx.get("upstream_call", "stream", False) or self._ctx.get("validation", "stream", False)

    def get_provider(self) -> str | None:
        """获取使用的 provider"""
        return self._ctx.get("routing", "provider") or self._ctx.get("upstream_call", "provider")

    def get_model(self) -> str | None:
        """获取使用的 model"""
        return self._ctx.requested_model or self._ctx.get("validation", "model")

    def get_preset_item_id(self) -> str | None:
        """获取使用的 preset_item_id"""
        return self._ctx.get("routing", "preset_item_id")

    # ===== 原始上下文访问 =====

    def get_raw(self, step: str, key: str, default: Any = None) -> Any:
        """获取原始上下文值（用于未类型化的字段）"""
        return self._ctx.get(step, key, default)

    def set_raw(self, step: str, key: str, value: Any) -> None:
        """设置原始上下文值"""
        self._ctx.set(step, key, value)

    @property
    def raw_context(self) -> WorkflowContext:
        """获取原始 WorkflowContext（用于需要完整访问的场景）"""
        return self._ctx
