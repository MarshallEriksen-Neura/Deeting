"""
外部通道 Gateway API

职责：
- 处理第三方客户端的 AI 请求
- 使用外部通道编排流程（限流、脱敏、计费、审计）

依赖：
- GatewayOrchestrator: 编排器

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

import asyncio
import logging
import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.config import settings
from app.core.database import get_db
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import get_external_orchestrator, GatewayOrchestrator
from app.deps.external_auth import ExternalPrincipal
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
from app.repositories.api_key import ApiKeyRepository
from app.services.memory.external_memory import (
    derive_external_user_id,
    extract_user_message,
    persist_external_memory,
)
from app.services.providers.api_key import ApiKeyService
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


def _extract_bearer_token(value: str | None) -> str | None:
    if not value:
        return None
    prefix = "bearer "
    lowered = value.strip()
    if lowered.lower().startswith(prefix):
        return lowered[len(prefix):].strip()
    return None


def _pick_header(request: Request, header_name: str) -> str | None:
    return request.headers.get(header_name) if request else None


def _resolve_external_key(request: Request, path: str) -> str | None:
    if not request:
        return None

    if path.endswith("/messages"):
        candidates = [
            _pick_header(request, "x-api-key"),
            _pick_header(request, "anthropic-api-key"),
            _extract_bearer_token(_pick_header(request, "authorization")),
            _pick_header(request, "x-goog-api-key"),
        ]
    else:
        candidates = [
            _extract_bearer_token(_pick_header(request, "authorization")),
            _pick_header(request, "x-api-key"),
            _pick_header(request, "x-goog-api-key"),
            _pick_header(request, "anthropic-api-key"),
        ]

    for item in candidates:
        if item:
            return item
    return None


async def _resolve_external_user_id(
    request: Request,
    path: str,
    db: AsyncSession,
) -> str | None:
    raw_key = _resolve_external_key(request, path)
    if not raw_key:
        return None
    if raw_key.startswith((ApiKeyService.PREFIX_EXTERNAL, ApiKeyService.PREFIX_INTERNAL)):
        try:
            repo = ApiKeyRepository(db)
            service = ApiKeyService(
                repository=repo,
                redis_client=getattr(cache, "_redis", None),
                secret_key=settings.JWT_SECRET_KEY or "dev-secret",
            )
            principal = await service.validate_key(raw_key)
            if principal and principal.user_id:
                return str(principal.user_id)
        except Exception as exc:
            logger.warning("external_user_id_resolve_failed err=%s", exc)
    return str(derive_external_user_id(raw_key))


async def _persist_external_memory(ctx: WorkflowContext) -> None:
    if not ctx.is_success or ctx.capability != "chat":
        return
    user_id = ctx.get("external_memory", "user_id")
    if not user_id:
        return
    try:
        user_uuid = uuid.UUID(str(user_id))
    except (ValueError, TypeError):
        return
    text = extract_user_message(ctx.get("validation", "request"))
    if not text:
        return
    await persist_external_memory(
        user_id=user_uuid,
        text=text,
        db_session=ctx.db_session,
        path=ctx.get("external_memory", "path"),
    )


def _schedule_external_memory(ctx: WorkflowContext) -> None:
    if not ctx.is_success or ctx.capability != "chat":
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(_persist_external_memory(ctx))

    def _log_task_error(t: asyncio.Task) -> None:
        try:
            exc = t.exception()
        except Exception as err:
            logger.warning("external_memory_task_exception trace_id=%s err=%s", ctx.trace_id, err)
            return
        if exc:
            logger.warning("external_memory_task_failed trace_id=%s err=%s", ctx.trace_id, exc)

    task.add_done_callback(_log_task_error)


async def _stream_external_callback(
    ctx: WorkflowContext,
    accumulator: StreamTokenAccumulator,
) -> None:
    await _stream_billing_callback(ctx, accumulator)
    _schedule_external_memory(ctx)


async def _stream_billing_callback(
    ctx: WorkflowContext,
    accumulator: StreamTokenAccumulator,
) -> None:
    """
    流式计费回调：在流完成后记录流水并调整差额（P0-1 + P0-3）
    
    改动：
    - 使用 BillingRepository.record_transaction 只记录流水
    - 使用 adjust_redis_balance 调整费用差额
    - 使用 TransactionAwareCelery 确保任务在事务提交后执行
    """
    # 获取定价配置：未配置视为免费（仅记录用量）
    pricing = ctx.get("routing", "pricing_config") or {}

    # 计算费用（未配置则为 0）
    input_tokens = ctx.billing.input_tokens
    output_tokens = ctx.billing.output_tokens

    input_per_1k = Decimal(str(pricing.get("input_per_1k", 0))) if pricing else Decimal("0")
    output_per_1k = Decimal(str(pricing.get("output_per_1k", 0))) if pricing else Decimal("0")

    input_cost = float((Decimal(input_tokens) / 1000) * input_per_1k) if pricing else 0.0
    output_cost = float((Decimal(output_tokens) / 1000) * output_per_1k) if pricing else 0.0
    total_cost = input_cost + output_cost

    # 更新 billing 信息
    ctx.billing.input_cost = input_cost
    ctx.billing.output_cost = output_cost
    ctx.billing.total_cost = total_cost
    ctx.billing.currency = pricing.get("currency", "USD") if pricing else ctx.billing.currency or "USD"

    # 记录流水并调整差额（内外通道统一）
    if pricing and ctx.tenant_id and ctx.db_session:
        try:
            repo = BillingRepository(ctx.db_session)
            
            # 获取预估费用（QuotaCheckStep 中扣减的金额）
            estimated_cost = await _get_estimated_cost_for_stream(ctx)
            cost_diff = Decimal(str(total_cost)) - Decimal(str(estimated_cost))
            
            # 记录交易流水（不扣减配额）
            await repo.record_transaction(
                tenant_id=ctx.tenant_id,
                amount=Decimal(str(total_cost)),
                trace_id=ctx.trace_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                input_price=input_per_1k,
                output_price=output_per_1k,
                provider=ctx.upstream_result.provider if hasattr(ctx, "upstream_result") else None,
                model=ctx.requested_model,
                preset_item_id=ctx.get("routing", "preset_item_id"),
                api_key_id=ctx.api_key_id,
                description="Stream billing completed",
            )
            
            # 如果实际费用与预估费用有差异，调整 Redis 余额
            if abs(float(cost_diff)) > 0.000001:
                await repo.adjust_redis_balance(ctx.tenant_id, cost_diff)
                logger.debug(
                    "stream_billing_cost_adjusted tenant=%s estimated=%s actual=%s diff=%s",
                    ctx.tenant_id,
                    estimated_cost,
                    total_cost,
                    cost_diff,
                )
            
            # 提交事务
            await ctx.db_session.commit()
            
        except Exception as e:
            logger.error(f"Stream billing failed trace_id={ctx.trace_id}: {e}")
            await ctx.db_session.rollback()
        else:
            # 持久化 budget_used（使用 TransactionAwareCelery）
            if ctx.api_key_id and total_cost > 0:
                try:
                    from app.core.transaction_celery import get_transaction_scheduler
                    from app.tasks.apikey_sync import sync_apikey_budget_task
                    
                    # 更新 Redis Hash 中的 budget_used
                    redis_client = getattr(cache, "_redis", None)
                    if redis_client:
                        from app.core.cache_keys import CacheKeys
                        key = CacheKeys.apikey_budget_hash(str(ctx.api_key_id))
                        full_key = cache._make_key(key)
                        await redis_client.hincrby(full_key, "budget_used", int(total_cost * 1000000))  # 微分单位
                        await redis_client.hincrby(full_key, "version", 1)
                    
                    # 使用事务感知调度器，在事务提交后同步到 DB
                    scheduler = get_transaction_scheduler(ctx.db_session)
                    scheduler.delay_after_commit(
                        sync_apikey_budget_task,
                        str(ctx.api_key_id),
                    )
                    
                    # 更新上下文
                    current_budget_used = float(ctx.get("external_auth", "budget_used") or 0.0)
                    ctx.set("external_auth", "budget_used", current_budget_used + total_cost)
                except Exception as exc:  # noqa: PERF203
                    logger.warning(f"Stream budget_used update failed trace_id={ctx.trace_id}: {exc}")

    # 记录用量（使用 TransactionAwareCelery）
    if ctx.db_session:
        try:
            from app.core.transaction_celery import get_transaction_scheduler
            
            scheduler = get_transaction_scheduler(ctx.db_session)
            
            # 延迟执行用量记录任务
            scheduler.apply_async_after_commit(
                _record_usage_task,
                kwargs={
                    "tenant_id": str(ctx.tenant_id) if ctx.tenant_id else None,
                    "api_key_id": str(ctx.api_key_id) if ctx.api_key_id else None,
                    "trace_id": ctx.trace_id,
                    "model": ctx.requested_model,
                    "capability": ctx.capability,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_cost": total_cost,
                    "currency": ctx.billing.currency,
                    "provider": ctx.upstream_result.provider if hasattr(ctx, "upstream_result") else None,
                    "latency_ms": ctx.upstream_result.latency_ms if hasattr(ctx, "upstream_result") else None,
                    "is_stream": True,
                    "stream_completed": accumulator.is_completed,
                    "stream_error": accumulator.error,
                },
            )
        except Exception as e:
            logger.error(f"Stream usage schedule failed trace_id={ctx.trace_id}: {e}")

    logger.info(
        f"Stream billing completed trace_id={ctx.trace_id} "
        f"tenant={ctx.tenant_id} "
        f"tokens={ctx.billing.total_tokens} "
        f"cost={total_cost:.6f} {ctx.billing.currency} "
        f"completed={accumulator.is_completed}"
    )


async def _get_estimated_cost_for_stream(ctx: WorkflowContext) -> float:
    """获取流式请求的预估费用（与 QuotaCheckStep 中的计算一致）"""
    pricing = ctx.get("routing", "pricing_config") or {}
    if not pricing:
        return 0.0

    request = ctx.get("validation", "request")
    max_tokens = getattr(request, "max_tokens", 4096) if request else 4096
    estimated_tokens = max_tokens * 2  # 输入+输出粗估

    avg_price = (
        float(pricing.get("input_per_1k", 0)) +
        float(pricing.get("output_per_1k", 0))
    ) / 2
    return (estimated_tokens / 1000) * avg_price


def _record_usage_task(**kwargs: Any) -> None:
    """用量记录任务（同步执行）"""
    try:
        usage_repo = UsageRepository()
        # 使用同步方法创建用量记录
        import asyncio
        asyncio.run(usage_repo.create(kwargs))
    except Exception as e:
        logger.error(f"Usage record failed trace_id={kwargs.get('trace_id')}: {e}")


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
    principal: ExternalPrincipal | None,
    db: AsyncSession,
    capability: str = "chat",
    adapter_vendor: str | None = None,
    user_id: str | None = None,
) -> WorkflowContext:
    """
    构建外部通道工作流上下文

    统一封装了:
    - 基础信息 (Tenant, API Key, IP)
    - 鉴权参数 (Scopes, Limits)
    - 签名参数 (Timestamp, Nonce, Signature)
    - 请求体 (Request Body / Adapter)
    """
    forwarded_for = request.headers.get("x-forwarded-for") if request else None
    client_ip = (
        forwarded_for.split(",")[0].strip()
        if forwarded_for
        else (request.client.host if request and request.client else None)
    )
    client_host = request.headers.get("x-forwarded-host") or request.headers.get("host")

    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability=capability,
        requested_model=getattr(request_body, "model", ""),
        db_session=db,
        tenant_id=principal.tenant_id if principal else None,
        api_key_id=principal.api_key_id if principal else None,
        client_ip=principal.client_ip if principal else client_ip,
        trace_id=getattr(request.state, "trace_id", None) if request else None,
    )
    ctx.user_id = user_id
    
    # 鉴权与配置
    if principal:
        ctx.set("auth", "scopes", principal.scopes)
        ctx.set("external_auth", "allowed_models", principal.allowed_models)
        ctx.set("external_auth", "allowed_ips", principal.allowed_ips)
        ctx.set("external_auth", "rate_limit_rpm", principal.rate_limit_rpm)
        ctx.set("external_auth", "budget_limit", principal.budget_limit)
        ctx.set("external_auth", "budget_used", principal.budget_used)
        ctx.set("external_auth", "enable_logging", principal.enable_logging)
    
    # 签名校验参数
    if principal:
        ctx.set("signature_verify", "timestamp", principal.timestamp)
        ctx.set("signature_verify", "nonce", principal.nonce)
        ctx.set("signature_verify", "signature", principal.signature)
        ctx.set("signature_verify", "api_key", principal.api_key)
        ctx.set("signature_verify", "api_secret", principal.api_secret)
        ctx.set("signature_verify", "client_host", principal.client_host)
    else:
        ctx.set("signature_verify", "client_host", client_host)
    
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
            on_complete=_stream_external_callback,
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
    orchestrator: GatewayOrchestrator = Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse | StreamingResponse:
    path = request.url.path if request else ""
    user_id = await _resolve_external_user_id(request, path, db)
    ctx = build_external_context(
        request=request,
        request_body=request_body,
        principal=None,
        db=db,
        capability="chat",
        user_id=user_id,
    )
    if user_id:
        ctx.set("external_memory", "user_id", user_id)
    ctx.set("external_memory", "path", path)
    await orchestrator.execute(ctx)
    return handle_workflow_result(ctx)


@router.post(
    "/messages",
    response_model=ChatCompletionResponse | GatewayError,
)
async def messages(
    request: Request,
    request_body: AnthropicMessagesRequest,
    orchestrator: GatewayOrchestrator = Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse | StreamingResponse:
    path = request.url.path if request else ""
    user_id = await _resolve_external_user_id(request, path, db)
    ctx = build_external_context(
        request=request,
        request_body=request_body,
        principal=None,
        db=db,
        capability="chat",
        adapter_vendor="anthropic",
        user_id=user_id,
    )
    if user_id:
        ctx.set("external_memory", "user_id", user_id)
    ctx.set("external_memory", "path", path)
    await orchestrator.execute(ctx)
    return handle_workflow_result(ctx)


@router.post(
    "/responses",
    response_model=ChatCompletionResponse | GatewayError,
)
async def responses(
    request: Request,
    request_body: ResponsesRequest,
    orchestrator: GatewayOrchestrator = Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse | StreamingResponse:
    path = request.url.path if request else ""
    user_id = await _resolve_external_user_id(request, path, db)
    ctx = build_external_context(
        request=request,
        request_body=request_body,
        principal=None,
        db=db,
        capability="chat",
        adapter_vendor="responses",
        user_id=user_id,
    )
    if user_id:
        ctx.set("external_memory", "user_id", user_id)
    ctx.set("external_memory", "path", path)
    await orchestrator.execute(ctx)
    return handle_workflow_result(ctx)


@router.post(
    "/embeddings",
    response_model=EmbeddingsResponse | GatewayError,
)
async def embeddings(
    request: Request,
    request_body: EmbeddingsRequest,
    orchestrator: GatewayOrchestrator = Depends(get_external_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    path = request.url.path if request else ""
    user_id = await _resolve_external_user_id(request, path, db)
    ctx = build_external_context(
        request=request,
        request_body=request_body,
        principal=None,
        db=db,
        capability="embedding",
        user_id=user_id,
    )
    if user_id:
        ctx.set("external_memory", "user_id", user_id)
    ctx.set("external_memory", "path", path)
    await orchestrator.execute(ctx)
    return handle_workflow_result(ctx)


@router.get("/models", response_model=ModelListResponse)
async def list_models(
    db: AsyncSession = Depends(get_db),
) -> ModelListResponse:
    allowed_providers, _, _ = _parse_provider_scopes(None)

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
