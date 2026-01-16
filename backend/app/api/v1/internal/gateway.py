"""
内部通道 Gateway API

职责：
- 处理内部前端的 AI 请求
- 使用内部通道编排流程（跳过签名校验、配额检查、脱敏）
- 支持调试接口

依赖：
- GatewayOrchestrator: 编排器
- get_current_user: JWT 用户认证
- ProviderPresetRepository: 路由查询

接口：
- POST /v1/chat/completions
  - 请求: OpenAI ChatCompletion 格式
  - 响应: OpenAI ChatCompletion 格式
  - 支持流式 (stream=true)

- POST /v1/embeddings
  - 请求: OpenAI Embeddings 格式
  - 响应: OpenAI Embeddings 格式

- GET /v1/models
  - 响应: 可用模型列表

调试接口（仅内部）：
- POST /v1/debug/test-routing
  - 测试路由决策，不实际调用上游

- GET /v1/debug/step-registry
  - 查看已注册的编排步骤
"""

import logging
from typing import Any

from fastapi import APIRouter

router = APIRouter(tags=["Internal Gateway"])

from fastapi import Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache_keys import CacheKeys
from app.core.distributed_lock import distributed_lock
from app.core.database import get_db
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import get_internal_orchestrator
from app.deps.auth import get_current_user
from app.models.conversation import ConversationChannel
from app.services.conversation.service import ConversationService
from app.schemas.gateway import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    EmbeddingsRequest,
    EmbeddingsResponse,
    ModelListResponse,
    GatewayError,
)
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.repositories.provider_instance_repository import (
    ProviderInstanceRepository,
    ProviderModelRepository,
)
from app.models import User
from app.services.workflow.steps.upstream_call import (
    StreamTokenAccumulator,
    stream_with_billing,
)
from app.api.v1.external.gateway import _stream_billing_callback
from app.schemas.bandit import BanditReportResponse, BanditReportSummary
from app.repositories.bandit_repository import BanditRepository

logger = logging.getLogger(__name__)


def _estimate_tokens(text: str) -> int:
    return max(1, int(len(text) / 4)) if text else 1


def _with_tokens(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for msg in messages:
        token_est = msg.get("token_estimate")
        content = msg.get("content", "")
        enriched.append(
            {
                **msg,
                "token_estimate": token_est
                if token_est is not None
                else _estimate_tokens(str(content)),
            }
        )
    return enriched


async def _append_stream_conversation(
    ctx: WorkflowContext,
    assistant_text: str | None,
) -> None:
    if ctx.capability != "chat" or ctx.is_external:
        return

    session_id = ctx.get("conversation", "session_id") or (
        (ctx.get("validation", "validated") or {}).get("session_id")
    )
    if not session_id:
        return

    try:
        conv_service = ConversationService()
    except Exception as exc:
        logger.warning(f"ConversationAppend skipped (redis unavailable): {exc}")
        return

    req = ctx.get("validation", "validated") or {}
    user_messages: list[dict[str, Any]] = req.get("messages", []) or []
    assistant_msg = (
        {"role": "assistant", "content": assistant_text}
        if assistant_text
        else None
    )

    msgs_to_append: list[dict[str, Any]] = []
    if user_messages:
        msgs_to_append.extend(_with_tokens(user_messages))
    if assistant_msg:
        msgs_to_append.append(_with_tokens([assistant_msg])[0])

    if not msgs_to_append:
        return

    lock_key = CacheKeys.session_lock(session_id)
    async with distributed_lock(lock_key, ttl=10, retry_times=3) as acquired:
        if not acquired:
            logger.warning(
                "conversation_append_lock_failed session=%s trace=%s",
                session_id,
                ctx.trace_id,
            )
            return

        await conv_service.append_messages(
            session_id=session_id,
            messages=msgs_to_append,
            channel=ConversationChannel.INTERNAL,
        )


async def _stream_internal_callback(
    ctx: WorkflowContext,
    accumulator: StreamTokenAccumulator,
) -> None:
    await _stream_billing_callback(ctx, accumulator)
    await _append_stream_conversation(ctx, accumulator.assistant_text)


@router.get(
    "/bandit/report",
    response_model=BanditReportResponse,
)
async def bandit_report(
    capability: str | None = None,
    model: str | None = None,
    channel: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BanditReportResponse:
    """
    Bandit 臂观测报表（内部通道，仅登录用户可见）。
    """

    repo = BanditRepository(db)
    items = await repo.get_report(capability=capability, model=model, channel=channel)

    total_trials = sum(i.get("total_trials", 0) for i in items) or 0
    total_successes = sum(i.get("successes", 0) for i in items) or 0
    overall_success_rate = (total_successes / total_trials) if total_trials else 0.0

    summary = BanditReportSummary(
        total_arms=len(items),
        total_trials=total_trials,
        overall_success_rate=overall_success_rate,
    )

    return BanditReportResponse(summary=summary, items=items)


@router.post(
    "/chat/completions",
    response_model=ChatCompletionResponse | GatewayError,
)
async def chat_completions(
    request: Request,
    request_body: ChatCompletionRequest,
    user: User = Depends(get_current_user),
    orchestrator=Depends(get_internal_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse | StreamingResponse:
    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        capability="chat",
        requested_model=request_body.model,
        db_session=db,
        tenant_id=str(user.id) if user else None,
        user_id=str(user.id) if user else None,
        api_key_id=str(user.id) if user else None,  # 内部通道用用户 UUID 充当 key 维度，便于统一监控
        trace_id=getattr(request.state, "trace_id", None) if request else None,
    )
    ctx.set("validation", "request", request_body)

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

        # 包装流式响应，在流完成后记录计费/用量
        wrapped_stream = stream_with_billing(
            stream=stream,
            ctx=ctx,
            accumulator=accumulator,
            on_complete=_stream_internal_callback,
        )
        return StreamingResponse(wrapped_stream, media_type="text/event-stream")

    response_body = ctx.get("response_transform", "response")
    status_code = ctx.get("upstream_call", "status_code") or 200
    return JSONResponse(content=response_body, status_code=status_code)


@router.post(
    "/embeddings",
    response_model=EmbeddingsResponse | GatewayError,
)
async def embeddings(
    request: Request,
    request_body: EmbeddingsRequest,
    user: User = Depends(get_current_user),
    orchestrator=Depends(get_internal_orchestrator),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        capability="embedding",
        requested_model=request_body.model,
        db_session=db,
        tenant_id=str(user.id) if user else None,
        user_id=str(user.id) if user else None,
        api_key_id=str(user.id) if user else None,  # 内部通道用用户 UUID 充当 key 维度，便于统一监控
        trace_id=getattr(request.state, "trace_id", None) if request else None,
    )
    ctx.set("validation", "request", request_body)

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

    response_body = ctx.get("response_transform", "response")
    status_code = ctx.get("upstream_call", "status_code") or 200
    return JSONResponse(content=response_body, status_code=status_code)


@router.get("/models", response_model=ModelListResponse)
async def list_models(
    db: AsyncSession = Depends(get_db),
) -> ModelListResponse:
    preset_repo = ProviderPresetRepository(db)
    instance_repo = ProviderInstanceRepository(db)
    model_repo = ProviderModelRepository(db)

    instances = await instance_repo.get_available_instances(user_id=None, include_public=True)
    if not instances:
        return ModelListResponse(data=[])

    preset_cache: dict[str, any] = {}
    inst_map = {str(i.id): i for i in instances if i.channel in {"internal", "both"}}
    models = await model_repo.list()

    data = []
    for m in models:
        inst = inst_map.get(str(m.instance_id))
        if not inst or not m.is_active:
            continue
        if inst.preset_slug not in preset_cache:
            preset_cache[inst.preset_slug] = await preset_repo.get_by_slug(inst.preset_slug)
        preset = preset_cache.get(inst.preset_slug)
        if not preset or not preset.is_active:
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
