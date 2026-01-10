"""
外部通道 Gateway API

职责：
- 处理第三方客户端的 AI 请求
- 使用外部通道编排流程（完整的签名、配额、限流、脱敏）
- 严格计费和审计

依赖：
- GatewayOrchestrator: 编排器
- get_external_principal: 外部鉴权（签名校验）
- QuotaService: 配额检查
- BillingService: 计费扣费

请求头要求:
- X-API-Key: API 密钥
- X-Timestamp: 请求时间戳（秒）
- X-Nonce: 请求唯一标识
- X-Signature: HMAC-SHA256 签名

签名算法:
  message = f"{api_key}{timestamp}{nonce}{request_body_hash}"
  signature = HMAC-SHA256(secret, message)

接口：
- POST /v1/chat/completions
  - 请求: OpenAI ChatCompletion 格式
  - 响应: OpenAI ChatCompletion 格式（已脱敏）
  - 支持流式 (stream=true)

- POST /v1/embeddings
  - 请求: OpenAI Embeddings 格式
  - 响应: OpenAI Embeddings 格式（已脱敏）

- GET /v1/models
  - 响应: 可用模型列表（按权限过滤）

响应头:
- X-Request-Id: 请求追踪 ID
- X-RateLimit-Remaining: 剩余请求数
- X-RateLimit-Reset: 重置时间

错误码:
- 401: 签名无效/API Key 无效
- 403: 权限不足/配额不足
- 429: 请求过于频繁
- 502: 上游服务错误
- 504: 上游服务超时
"""

import logging
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import get_external_orchestrator, GatewayOrchestrator
from app.deps.external_auth import ExternalPrincipal, get_external_principal
from app.schemas.gateway import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    AnthropicMessagesRequest,
    EmbeddingsRequest,
    EmbeddingsResponse,
    ModelListResponse,
    ResponsesRequest,
    GatewayError,
)
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.repositories.provider_instance_repository import (
    ProviderInstanceRepository,
    ProviderModelRepository,
)
from app.services.workflow.steps.upstream_call import (
    StreamTokenAccumulator,
    stream_with_billing,
)
from app.repositories.billing_repository import BillingRepository
from app.repositories.usage_repository import UsageRepository

router = APIRouter(tags=["External Gateway"])
logger = logging.getLogger(__name__)


# ==========================================
# Helpers (Context Builder & Result Handler)
# ==========================================


def _parse_provider_scopes(scopes: list[str] | None) -> tuple[set[str], set[str], set[str]]:
    """解析 provider/preset/preset_item 范围，供路由与模型列表过滤。"""
    providers: set[str] = set()
    presets: set[str] = set()
    preset_items: set[str] = set()
    if not scopes:
        return providers, presets, preset_items

    for scope in scopes:
        if not scope or ":" not in scope:
            continue
        scope_type, scope_value = scope.split(":", 1)
        match scope_type:
            case "provider":
                providers.add(scope_value)
            case "preset":
                presets.add(scope_value)
            case "preset_item":
                preset_items.add(scope_value)
    return providers, presets, preset_items


async def _stream_billing_callback(
    ctx: WorkflowContext,
    accumulator: StreamTokenAccumulator,
) -> None:
    """
    流式计费回调：在流完成后触发计费
    """
    # 获取定价配置：未配置视为免费（仅记录用量）
    pricing = ctx.get("routing", "pricing_config") or {}

    # 计算费用（未配置则为 0）
    input_tokens = ctx.billing.input_tokens
    output_tokens = ctx.billing.output_tokens

    input_per_1k = Decimal(str(pricing.get("input_per_1k", 0)))
    output_per_1k = Decimal(str(pricing.get("output_per_1k", 0)))

    input_cost = float((Decimal(input_tokens) / 1000) * input_per_1k) if pricing else 0.0
    output_cost = float((Decimal(output_tokens) / 1000) * output_per_1k) if pricing else 0.0
    total_cost = input_cost + output_cost

    # 更新 billing 信息
    ctx.billing.input_cost = input_cost
    ctx.billing.output_cost = output_cost
    ctx.billing.total_cost = total_cost
    ctx.billing.currency = pricing.get("currency", "USD") if pricing else ctx.billing.currency or "USD"

    # 外部通道：扣减余额
    if pricing and ctx.is_external and ctx.tenant_id and ctx.db_session:
        try:
            repo = BillingRepository(ctx.db_session)
            await repo.deduct(
                tenant_id=ctx.tenant_id,
                amount=Decimal(str(total_cost)),
                trace_id=ctx.trace_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                input_price=input_per_1k,
                output_price=output_per_1k,
                provider=ctx.upstream_result.provider,
                model=ctx.requested_model,
                preset_item_id=ctx.get("routing", "preset_item_id"),
                api_key_id=ctx.api_key_id,
                allow_negative=True,  # 流式允许负值，因为已经消费
            )
        except Exception as e:
            logger.error(f"Stream billing deduct failed trace_id={ctx.trace_id}: {e}")

    # 记录用量
    try:
        usage_repo = UsageRepository()
        await usage_repo.create({
            "tenant_id": ctx.tenant_id,
            "api_key_id": ctx.api_key_id,
            "trace_id": ctx.trace_id,
            "model": ctx.requested_model,
            "capability": ctx.capability,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_cost": total_cost,
            "currency": ctx.billing.currency,
            "provider": ctx.upstream_result.provider,
            "latency_ms": ctx.upstream_result.latency_ms,
            "is_stream": True,
            "stream_completed": accumulator.is_completed,
            "stream_error": accumulator.error,
        })
    except Exception as e:
        logger.error(f"Stream usage record failed trace_id={ctx.trace_id}: {e}")

    logger.info(
        f"Stream billing completed trace_id={ctx.trace_id} "
        f"tenant={ctx.tenant_id} "
        f"tokens={ctx.billing.total_tokens} "
        f"cost={total_cost:.6f} {ctx.billing.currency} "
        f"completed={accumulator.is_completed}"
    )


def _resolve_error_status(ctx: WorkflowContext) -> int:
    """根据上下文错误码推导 HTTP 状态码。"""
    if ctx.error_code in {"SIGNATURE_INVALID", "SIGNATURE_MISSING", "SIGNATURE_VERIFY_FAILED"} or getattr(ctx, "failed_step", None) == "signature_verify":
        return 401
    if ctx.error_code and ctx.error_code.startswith("RATE_LIMIT"):
        return 429
    if ctx.error_code == "INSUFFICIENT_BALANCE":
        return 402
    if ctx.error_code == "INSUFFICIENT_QUOTA":
        return 403
    return ctx.get("billing", "http_status") or ctx.upstream_result.status_code or 400


def build_external_context(
    request: Request,
    request_body: BaseModel,
    principal: ExternalPrincipal,
    db: AsyncSession,
    capability: str = "chat",
    adapter_vendor: str | None = None,
) -> WorkflowContext:
    """
    构建外部通道工作流上下文

    统一封装了:
    - 基础信息 (Tenant, API Key, IP)
    - 鉴权参数 (Scopes, Limits)
    - 签名参数 (Timestamp, Nonce, Signature)
    - 请求体 (Request Body / Adapter)
    """
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability=capability,
        requested_model=getattr(request_body, "model", ""),
        db_session=db,
        tenant_id=principal.tenant_id,
        api_key_id=principal.api_key_id,
        client_ip=principal.client_ip,
        trace_id=getattr(request.state, "trace_id", None) if request else None,
    )
    
    # 鉴权与配置
    ctx.set("auth", "scopes", principal.scopes)
    ctx.set("external_auth", "allowed_models", principal.allowed_models)
    ctx.set("external_auth", "allowed_ips", principal.allowed_ips)
    ctx.set("external_auth", "rate_limit_rpm", principal.rate_limit_rpm)
    ctx.set("external_auth", "budget_limit", principal.budget_limit)
    ctx.set("external_auth", "budget_used", principal.budget_used)
    ctx.set("external_auth", "enable_logging", principal.enable_logging)
    
    # 签名校验参数
    ctx.set("signature_verify", "timestamp", principal.timestamp)
    ctx.set("signature_verify", "nonce", principal.nonce)
    ctx.set("signature_verify", "signature", principal.signature)
    ctx.set("signature_verify", "api_key", principal.api_key)
    ctx.set("signature_verify", "api_secret", principal.api_secret)
    ctx.set("signature_verify", "client_host", principal.client_host)
    
    # 路由配置
    ctx.set("routing", "allow_fallback", True)

    # 请求体注入
    if adapter_vendor:
        ctx.set("adapter", "vendor", adapter_vendor)
        ctx.set("adapter", "raw_request", request_body)
    else:
        ctx.set("validation", "request", request_body)

    return ctx


def handle_workflow_result(ctx: WorkflowContext) -> JSONResponse | StreamingResponse:
    """
    统一处理编排结果

    - 错误处理与映射
    - 流式响应封装 (SSE + Billing)
    - 普通 JSON 响应
    """
    # 1. 错误处理
    if not ctx.is_success:
        upstream_status = ctx.get("upstream_call", "status_code") or ctx.upstream_result.status_code
        try:
            upstream_status = int(upstream_status) if upstream_status is not None else None
        except Exception:
            upstream_status = None

        return JSONResponse(
            status_code=_resolve_error_status(ctx),
            content=GatewayError(
                code=ctx.error_code or "GATEWAY_ERROR",
                message=ctx.error_message or "Request failed",
                source=ctx.error_source.value if ctx.error_source else "gateway",
                trace_id=ctx.trace_id,
                upstream_status=upstream_status,
                upstream_code=ctx.upstream_result.error_code,
            ).model_dump(),
        )

    # 2. 流式响应处理
    if ctx.get("upstream_call", "stream"):
        stream = ctx.get("upstream_call", "response_stream")
        accumulator = ctx.get("upstream_call", "stream_accumulator") or StreamTokenAccumulator()

        # 包装流式响应，在流完成后触发计费
        wrapped_stream = stream_with_billing(
            stream=stream,
            ctx=ctx,
            accumulator=accumulator,
            on_complete=_stream_billing_callback,
        )
        return StreamingResponse(wrapped_stream, media_type="text/event-stream")

    # 3. 普通响应处理
    response_body = ctx.get("sanitize", "response") or ctx.get(
        "response_transform", "response"
    )
    status_code = ctx.get("upstream_call", "status_code") or 200
    try:
        status_code = int(status_code)
    except (ValueError, TypeError):
        status_code = 200

    return JSONResponse(content=response_body, status_code=status_code)


# ==========================================
# Route Handlers
# ==========================================


@router.post(
    "/chat/completions",
    response_model=ChatCompletionResponse | GatewayError,
)
async def chat_completions(
    request: Request,
    request_body: ChatCompletionRequest,
    principal: ExternalPrincipal = Depends(get_external_principal),
    orchestrator: GatewayOrchestrator = Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse | StreamingResponse:
    ctx = build_external_context(
        request=request,
        request_body=request_body,
        principal=principal,
        db=db,
        capability="chat",
    )
    await orchestrator.execute(ctx)
    return handle_workflow_result(ctx)


@router.post(
    "/messages",
    response_model=ChatCompletionResponse | GatewayError,
)
async def messages(
    request: Request,
    request_body: AnthropicMessagesRequest,
    principal: ExternalPrincipal = Depends(get_external_principal),
    orchestrator: GatewayOrchestrator = Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse | StreamingResponse:
    ctx = build_external_context(
        request=request,
        request_body=request_body,
        principal=principal,
        db=db,
        capability="chat",
        adapter_vendor="anthropic",
    )
    await orchestrator.execute(ctx)
    return handle_workflow_result(ctx)


@router.post(
    "/responses",
    response_model=ChatCompletionResponse | GatewayError,
)
async def responses(
    request: Request,
    request_body: ResponsesRequest,
    principal: ExternalPrincipal = Depends(get_external_principal),
    orchestrator: GatewayOrchestrator = Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse | StreamingResponse:
    ctx = build_external_context(
        request=request,
        request_body=request_body,
        principal=principal,
        db=db,
        capability="chat",
        adapter_vendor="responses",
    )
    await orchestrator.execute(ctx)
    return handle_workflow_result(ctx)


@router.post(
    "/embeddings",
    response_model=EmbeddingsResponse | GatewayError,
)
async def embeddings(
    request: Request,
    request_body: EmbeddingsRequest,
    principal: ExternalPrincipal = Depends(get_external_principal),
    orchestrator: GatewayOrchestrator = Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    ctx = build_external_context(
        request=request,
        request_body=request_body,
        principal=principal,
        db=db,
        capability="embedding",
    )
    await orchestrator.execute(ctx)
    return handle_workflow_result(ctx)


@router.get("/models", response_model=ModelListResponse)
async def list_models(
    principal: ExternalPrincipal = Depends(get_external_principal),
    db: AsyncSession = Depends(get_db),
) -> ModelListResponse:
    allowed_providers, _, _ = _parse_provider_scopes(principal.scopes)

    preset_repo = ProviderPresetRepository(db)
    instance_repo = ProviderInstanceRepository(db)
    model_repo = ProviderModelRepository(db)

    instances = await instance_repo.get_available_instances(user_id=None, include_public=True)
    if not instances:
        return ModelListResponse(data=[])

    # 预取模板
    presets: dict[str, Any] = {}
    for inst in instances:
        if inst.preset_slug not in presets:
            presets[inst.preset_slug] = await preset_repo.get_by_slug(inst.preset_slug)

    instance_map = {str(inst.id): inst for inst in instances}
    models = await model_repo.list()
    data = []
    for m in models:
        inst = instance_map.get(str(m.instance_id))
        if not inst or inst.channel not in {"external", "both"}:
            continue
        preset = presets.get(inst.preset_slug)
        if not preset or not preset.is_active:
            continue
        if allowed_providers and preset.provider not in allowed_providers:
            continue
        if not m.is_active:
            continue
        icon = inst.icon or preset.icon if hasattr(preset, "icon") else None
        data.append(
            {
                "id": m.unified_model_id or m.model_id,
                "object": "model",
                "owned_by": preset.provider,
                "icon": icon,
                "upstream_model_id": m.model_id,
            }
        )

    return ModelListResponse(data=data)
