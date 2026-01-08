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

from fastapi import APIRouter

router = APIRouter(tags=["External Gateway"])

from fastapi import Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import get_external_orchestrator
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
from app.repositories.provider_preset_repository import (
    ProviderPresetItemRepository,
    ProviderPresetRepository,
)
from app.services.workflow.steps.upstream_call import (
    StreamTokenAccumulator,
    stream_with_billing,
)
from app.repositories.billing_repository import BillingRepository
from app.repositories.usage_repository import UsageRepository
from app.models.public_model import PublicModel

logger = logging.getLogger(__name__)


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

    职责：
    - 从 accumulator 获取 token 用量
    - 计算费用
    - 扣减余额（外部通道）
    - 记录用量
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


@router.post(
    "/chat/completions",
    response_model=ChatCompletionResponse | GatewayError,
)
async def chat_completions(
    request: Request,
    request_body: ChatCompletionRequest,
    principal: ExternalPrincipal = Depends(get_external_principal),
    orchestrator=Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse | StreamingResponse:
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability="chat",
        requested_model=request_body.model,
        db_session=db,
        tenant_id=principal.tenant_id,
        api_key_id=principal.api_key_id,
        client_ip=principal.client_ip,
        trace_id=getattr(request.state, "trace_id", None) if request else None,
    )
    ctx.set("auth", "scopes", principal.scopes)
    ctx.set("validation", "request", request_body)
    ctx.set("signature_verify", "timestamp", principal.timestamp)
    ctx.set("signature_verify", "nonce", principal.nonce)
    ctx.set("signature_verify", "signature", principal.signature)
    ctx.set("signature_verify", "api_key", principal.api_key)
    ctx.set("signature_verify", "api_secret", principal.api_secret)  # 独立签名密钥
    ctx.set("signature_verify", "client_host", principal.client_host)

    result = await orchestrator.execute(ctx)

    if not result.success or not ctx.is_success:
        return JSONResponse(
            status_code=400,
            content=GatewayError(
                code=ctx.error_code or "GATEWAY_ERROR",
                message=ctx.error_message or "Request failed",
                source=ctx.error_source.value if ctx.error_source else "gateway",
                trace_id=ctx.trace_id,
                upstream_status=ctx.upstream_result.status_code,
                upstream_code=ctx.upstream_result.error_code,
            ).model_dump(),
        )

    # 流式响应：使用计费包装器
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

    response_body = ctx.get("sanitize", "response") or ctx.get(
        "response_transform", "response"
    )
    status_code = ctx.get("upstream_call", "status_code") or 200
    return JSONResponse(content=response_body, status_code=status_code)


@router.post(
    "/messages",
    response_model=ChatCompletionResponse | GatewayError,
)
async def messages(
    request: Request,
    request_body: AnthropicMessagesRequest,
    principal: ExternalPrincipal = Depends(get_external_principal),
    orchestrator=Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse | StreamingResponse:
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability="chat",
        requested_model=request_body.model,
        db_session=db,
        tenant_id=principal.tenant_id,
        api_key_id=principal.api_key_id,
        client_ip=principal.client_ip,
        trace_id=getattr(request.state, "trace_id", None) if request else None,
    )
    ctx.set("auth", "scopes", principal.scopes)
    ctx.set("adapter", "vendor", "anthropic")
    ctx.set("adapter", "raw_request", request_body)
    ctx.set("signature_verify", "timestamp", principal.timestamp)
    ctx.set("signature_verify", "nonce", principal.nonce)
    ctx.set("signature_verify", "signature", principal.signature)
    ctx.set("signature_verify", "api_key", principal.api_key)
    ctx.set("signature_verify", "api_secret", principal.api_secret)
    ctx.set("signature_verify", "client_host", principal.client_host)

    result = await orchestrator.execute(ctx)

    if not result.success or not ctx.is_success:
        return JSONResponse(
            status_code=400,
            content=GatewayError(
                code=ctx.error_code or "GATEWAY_ERROR",
                message=ctx.error_message or "Request failed",
                source=ctx.error_source.value if ctx.error_source else "gateway",
                trace_id=ctx.trace_id,
                upstream_status=ctx.upstream_result.status_code,
                upstream_code=ctx.upstream_result.error_code,
            ).model_dump(),
        )

    if ctx.get("upstream_call", "stream"):
        stream = ctx.get("upstream_call", "response_stream")
        accumulator = ctx.get("upstream_call", "stream_accumulator") or StreamTokenAccumulator()
        wrapped_stream = stream_with_billing(
            stream=stream,
            ctx=ctx,
            accumulator=accumulator,
            on_complete=_stream_billing_callback,
        )
        return StreamingResponse(wrapped_stream, media_type="text/event-stream")

    response_body = ctx.get("sanitize", "response") or ctx.get(
        "response_transform", "response"
    )
    status_code = ctx.get("upstream_call", "status_code") or 200
    return JSONResponse(content=response_body, status_code=status_code)


@router.post(
    "/responses",
    response_model=ChatCompletionResponse | GatewayError,
)
async def responses(
    request: Request,
    request_body: ResponsesRequest,
    principal: ExternalPrincipal = Depends(get_external_principal),
    orchestrator=Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse | StreamingResponse:
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability="chat",
        requested_model=request_body.model,
        db_session=db,
        tenant_id=principal.tenant_id,
        api_key_id=principal.api_key_id,
        client_ip=principal.client_ip,
        trace_id=getattr(request.state, "trace_id", None) if request else None,
    )
    ctx.set("auth", "scopes", principal.scopes)
    ctx.set("adapter", "vendor", "responses")
    ctx.set("adapter", "raw_request", request_body)
    ctx.set("signature_verify", "timestamp", principal.timestamp)
    ctx.set("signature_verify", "nonce", principal.nonce)
    ctx.set("signature_verify", "signature", principal.signature)
    ctx.set("signature_verify", "api_key", principal.api_key)
    ctx.set("signature_verify", "api_secret", principal.api_secret)
    ctx.set("signature_verify", "client_host", principal.client_host)

    result = await orchestrator.execute(ctx)

    if not result.success or not ctx.is_success:
        return JSONResponse(
            status_code=400,
            content=GatewayError(
                code=ctx.error_code or "GATEWAY_ERROR",
                message=ctx.error_message or "Request failed",
                source=ctx.error_source.value if ctx.error_source else "gateway",
                trace_id=ctx.trace_id,
                upstream_status=ctx.upstream_result.status_code,
                upstream_code=ctx.upstream_result.error_code,
            ).model_dump(),
        )

    if ctx.get("upstream_call", "stream"):
        stream = ctx.get("upstream_call", "response_stream")
        accumulator = ctx.get("upstream_call", "stream_accumulator") or StreamTokenAccumulator()
        wrapped_stream = stream_with_billing(
            stream=stream,
            ctx=ctx,
            accumulator=accumulator,
            on_complete=_stream_billing_callback,
        )
        return StreamingResponse(wrapped_stream, media_type="text/event-stream")

    response_body = ctx.get("sanitize", "response") or ctx.get(
        "response_transform", "response"
    )
    status_code = ctx.get("upstream_call", "status_code") or 200
    return JSONResponse(content=response_body, status_code=status_code)


@router.post(
    "/embeddings",
    response_model=EmbeddingsResponse | GatewayError,
)
async def embeddings(
    request: Request,
    request_body: EmbeddingsRequest,
    principal: ExternalPrincipal = Depends(get_external_principal),
    orchestrator=Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability="embedding",
        requested_model=request_body.model,
        db_session=db,
        tenant_id=principal.tenant_id,
        api_key_id=principal.api_key_id,
        client_ip=principal.client_ip,
        trace_id=getattr(request.state, "trace_id", None) if request else None,
    )
    ctx.set("auth", "scopes", principal.scopes)
    ctx.set("validation", "request", request_body)
    ctx.set("signature_verify", "timestamp", principal.timestamp)
    ctx.set("signature_verify", "nonce", principal.nonce)
    ctx.set("signature_verify", "signature", principal.signature)
    ctx.set("signature_verify", "api_key", principal.api_key)
    ctx.set("signature_verify", "api_secret", principal.api_secret)  # 独立签名密钥
    ctx.set("signature_verify", "client_host", principal.client_host)

    result = await orchestrator.execute(ctx)
    if not result.success or not ctx.is_success:
        return JSONResponse(
            status_code=400,
            content=GatewayError(
                code=ctx.error_code or "GATEWAY_ERROR",
                message=ctx.error_message or "Request failed",
                source=ctx.error_source.value if ctx.error_source else "gateway",
                trace_id=ctx.trace_id,
                upstream_status=ctx.upstream_result.status_code,
                upstream_code=ctx.upstream_result.error_code,
            ).model_dump(),
        )

    response_body = ctx.get("sanitize", "response") or ctx.get(
        "response_transform", "response"
    )
    status_code = ctx.get("upstream_call", "status_code") or 200
    return JSONResponse(content=response_body, status_code=status_code)


@router.get("/models", response_model=ModelListResponse)
async def list_models(
    principal: ExternalPrincipal = Depends(get_external_principal),
    db: AsyncSession = Depends(get_db),
) -> ModelListResponse:
    allowed_providers, allowed_presets, allowed_preset_items = _parse_provider_scopes(
        principal.scopes
    )

    preset_repo = ProviderPresetRepository(db)
    item_repo = ProviderPresetItemRepository(db)

    presets = await preset_repo.get_active_presets()
    items = []
    for preset in presets:
        if allowed_providers and preset.provider not in allowed_providers:
            continue
        if allowed_presets and str(preset.id) not in allowed_presets:
            continue

        # 仅外部通道
        scoped_items = await item_repo.get_by_capability(
            preset_id=str(preset.id),
            capability="chat",
            channel="external",
        )

        for item in scoped_items:
            if allowed_preset_items and str(item.id) not in allowed_preset_items:
                continue
            if item.visibility not in {"public", "shared"} or not item.is_active:
                continue
            items.append(item)

    logical_ids: set[str] = set()
    for item in items:
        logical_ids.add(item.unified_model_id or item.model)

    if not logical_ids:
        return ModelListResponse(data=[])

    stmt = (
        select(PublicModel)
        .where(PublicModel.model_id.in_(logical_ids))
        .where(PublicModel.is_public == True)  # noqa: E712
        .order_by(PublicModel.sort_order.asc(), PublicModel.display_name.asc())
    )
    result = await db.execute(stmt)
    public_models: list[PublicModel] = list(result.scalars().all())
    public_ids = {m.model_id for m in public_models}

    data = [
        {"id": m.model_id, "object": "model", "owned_by": "gateway"}
        for m in public_models
    ]

    # 补充未录入 public_model 的逻辑 ID（保持兼容）
    missing_ids = sorted(logical_ids - public_ids)
    data.extend({"id": mid, "object": "model", "owned_by": "gateway"} for mid in missing_ids)

    return ModelListResponse(data=data)
