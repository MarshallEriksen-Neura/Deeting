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

import asyncio
import json
import logging
import re
import time
from typing import Any, AsyncIterator
from uuid import UUID

from fastapi import APIRouter

router = APIRouter(tags=["Internal Gateway"])

from fastapi import Depends, HTTPException, Request, Query, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache_keys import CacheKeys
from app.core.distributed_lock import distributed_lock
from app.core.database import get_db
from app.services.system import CancelService
from app.services.orchestrator.context import Channel, ErrorSource, WorkflowContext
from app.services.orchestrator.config import INTERNAL_DEBUG_WORKFLOW
from app.services.orchestrator.orchestrator import GatewayOrchestrator, get_internal_orchestrator
from app.services.orchestrator.registry import step_registry
from app.deps.auth import get_current_user
from app.models.conversation import ConversationChannel
from app.services.conversation.service import ConversationService
from app.services.conversation.session_service import ConversationSessionService
from app.services.conversation.turn_index_sync import sync_redis_last_turn
from app.repositories.conversation_message_repository import ConversationMessageRepository
from app.services.conversation.topic_namer import TOPIC_NAMING_META_KEY, extract_first_user_message
from app.schemas.gateway import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionCancelResponse,
    EmbeddingsRequest,
    EmbeddingsResponse,
    ModelGroupListResponse,
    GatewayError,
    RoutingTestRequest,
    RoutingTestResponse,
    StepRegistryResponse,
)
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.repositories.bandit_repository import BanditRepository
from app.repositories.provider_instance_repository import (
    ProviderInstanceRepository,
    ProviderModelRepository,
)
from app.constants.model_capability_map import expand_capabilities
from app.models import User
from app.services.workflow.steps.upstream_call import (
    StreamTokenAccumulator,
    stream_with_billing,
)
from app.api.v1.external.gateway import _stream_billing_callback
from app.schemas.bandit import BanditReportResponse, BanditReportSummary

logger = logging.getLogger(__name__)

def _format_sse(payload: dict[str, Any] | str) -> bytes:
    if isinstance(payload, str):
        data = payload
    else:
        data = json.dumps(payload, ensure_ascii=False, default=str)
    return f"data: {data}\n\n".encode("utf-8")


async def _status_stream_chat(
    ctx: WorkflowContext,
    orchestrator: GatewayOrchestrator,
) -> AsyncIterator[bytes]:
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=200)
    request_id = ctx.get("request", "request_id")
    cancel_service = CancelService()
    can_check_cancel = bool(request_id and ctx.user_id)
    last_cancel_check = 0.0

    def emitter(payload: dict[str, Any]) -> None:
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            pass

    ctx.status_emitter = emitter
    ctx.emit_status(stage="listen", step="request_adapter", state="running")

    task = asyncio.create_task(orchestrator.execute(ctx))

    while True:
        if can_check_cancel and time.monotonic() - last_cancel_check > 0.3:
            last_cancel_check = time.monotonic()
            if await cancel_service.consume_cancel(
                capability="chat",
                user_id=str(ctx.user_id),
                request_id=str(request_id),
            ):
                if not task.done():
                    task.cancel()
                ctx.mark_error(ErrorSource.CLIENT, "CLIENT_CANCELLED", "client canceled")
                yield _format_sse("[DONE]")
                return
        if task.done() and queue.empty():
            break
        try:
            payload = await asyncio.wait_for(queue.get(), timeout=0.25)
            yield _format_sse(payload)
        except TimeoutError:
            continue

    result = await task
    if not result.success or not ctx.is_success:
        yield _format_sse(
            {
                "type": "error",
                "error_code": ctx.error_code or "GATEWAY_ERROR",
                "message": ctx.error_message or "Request failed",
                "source": ctx.error_source.value if ctx.error_source else "gateway",
                "trace_id": ctx.trace_id,
            }
        )
        yield _format_sse("[DONE]")
        return

    if ctx.get("upstream_call", "stream"):
        if ctx.status_stage != "render":
            yield _format_sse(
                {
                    "type": "status",
                    "stage": "render",
                    "step": "upstream_call",
                    "state": "streaming",
                    "trace_id": ctx.trace_id,
                    "timestamp": ctx.created_at.isoformat(),
                }
            )
        stream = ctx.get("upstream_call", "response_stream")
        accumulator = ctx.get("upstream_call", "stream_accumulator") or StreamTokenAccumulator()
        wrapped_stream = stream_with_billing(
            stream=stream,
            ctx=ctx,
            accumulator=accumulator,
            on_complete=_stream_internal_callback,
        )
        async for chunk in wrapped_stream:
            yield chunk
        return

    response_body = ctx.get("response_transform", "response") or ctx.get("upstream_call", "response") or {}
    yield _format_sse(response_body)
    yield _format_sse("[DONE]")


def _estimate_tokens(text: str) -> int:
    return max(1, int(len(text) / 4)) if text else 1


def _content_for_tokens(content: Any) -> str:
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    try:
        return json.dumps(content, ensure_ascii=False)
    except TypeError:
        return str(content)


def _build_meta_info(message: dict[str, Any], content: Any) -> dict[str, Any] | None:
    meta_info = message.get("meta_info") or {}
    extras = {}
    for key in (
        "tool_calls",
        "tool_call_id",
        "function_call",
        "attachments",
        "image_url",
        "audio",
        "modalities",
    ):
        if message.get(key) is not None:
            extras[key] = message.get(key)
    if not isinstance(content, str) and content is not None:
        extras["content"] = content
    if extras:
        meta_info = {**meta_info, **extras}
    return meta_info or None


def _build_blocks(
    *,
    content_text: str | None,
    tool_calls: Any,
) -> list[dict[str, Any]] | None:
    blocks: list[dict[str, Any]] = []
    if content_text:
        think_regex = re.compile(r"<think>([\\s\\S]*?)</think>", re.IGNORECASE)
        last_index = 0
        for match in think_regex.finditer(content_text):
            if match.start() > last_index:
                text = content_text[last_index:match.start()]
                if text.strip():
                    blocks.append({"type": "text", "content": text})
            thought = match.group(1).strip()
            if thought:
                blocks.append({"type": "thought", "content": thought})
            last_index = match.end()
        if last_index < len(content_text):
            tail = content_text[last_index:]
            if tail.strip():
                blocks.append({"type": "text", "content": tail})
        if not blocks and content_text.strip():
            blocks.append({"type": "text", "content": content_text})

    if isinstance(tool_calls, list):
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            function = call.get("function") or {}
            name = function.get("name") or call.get("name")
            args = function.get("arguments") or call.get("arguments")
            if args is None:
                args_str = None
            elif isinstance(args, str):
                args_str = args
            else:
                args_str = json.dumps(args, ensure_ascii=False)
            blocks.append(
                {
                    "type": "tool_call",
                    "toolName": name,
                    "toolArgs": args_str,
                }
            )

    return blocks or None


def _prepare_messages(
    messages: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    db_messages: list[dict[str, Any]] = []
    redis_messages: list[dict[str, Any]] = []
    for msg in messages:
        content = msg.get("content")
        content_text = content if isinstance(content, str) else None
        content_for_tokens = _content_for_tokens(content)
        token_est = msg.get("token_estimate")
        meta_info = _build_meta_info(msg, content)
        blocks = _build_blocks(
            content_text=content_text,
            tool_calls=msg.get("tool_calls"),
        )
        if blocks and not (meta_info or {}).get("blocks"):
            meta_info = {**(meta_info or {}), "blocks": blocks}
        normalized = {
            **msg,
            "content": content_text,
            "token_estimate": token_est
            if token_est is not None
            else _estimate_tokens(content_for_tokens),
            "meta_info": meta_info,
        }
        db_messages.append(normalized)
        redis_messages.append({**normalized, "content": content_for_tokens})
    return db_messages, redis_messages


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

    conv_service: ConversationService | None = None
    redis_available = True
    try:
        conv_service = ConversationService()
    except Exception as exc:
        redis_available = False
        logger.warning(
            "ConversationAppend redis unavailable, fallback to db: %s", exc
        )

    req = ctx.get("validation", "validated") or {}
    user_messages: list[dict[str, Any]] = req.get("messages", []) or []
    assistant_id = req.get("assistant_id")
    assistant_msg = (
        {"role": "assistant", "content": assistant_text}
        if assistant_text
        else None
    )

    raw_messages: list[dict[str, Any]] = []
    if user_messages:
        raw_messages.extend(user_messages)
    if assistant_msg:
        raw_messages.append(assistant_msg)

    if not raw_messages:
        return

    db_messages, redis_messages = _prepare_messages(raw_messages)

    result: dict[str, Any] = {"should_flush": False, "last_turn": None}
    session_uuid: UUID | None = None
    if ctx.db_session is not None:
        try:
            session_uuid = UUID(session_id)
        except Exception:
            session_uuid = None

    if redis_available and conv_service:
        try:
            lock_key = CacheKeys.session_lock(session_id)
            async with distributed_lock(lock_key, ttl=10, retry_times=3) as acquired:
                if not acquired:
                    logger.warning(
                        "conversation_append_lock_failed session=%s trace=%s",
                        session_id,
                        ctx.trace_id,
                    )
                    return

                if ctx.db_session is not None and session_uuid is not None:
                    try:
                        await sync_redis_last_turn(
                            redis=conv_service.redis,
                            db_session=ctx.db_session,
                            session_id=session_id,
                            session_uuid=session_uuid,
                        )
                    except Exception as exc:
                        logger.warning(
                            "conversation_sync_turn_failed session=%s exc=%s",
                            session_id,
                            exc,
                        )

                result = await conv_service.append_messages(
                    session_id=session_id,
                    messages=redis_messages,
                    channel=ConversationChannel.INTERNAL,
                )
        except Exception as exc:
            redis_available = False
            logger.warning(
                "conversation_append_redis_failed session=%s exc=%s",
                session_id,
                exc,
            )

    if redis_available:
        for idx, msg in enumerate(db_messages):
            if idx < len(redis_messages):
                msg["turn_index"] = redis_messages[idx].get("turn_index")

    if ctx.db_session is not None:
        try:
            if session_uuid is None:
                session_uuid = UUID(session_id)
            user_uuid = UUID(ctx.user_id) if ctx.user_id else None
            tenant_uuid = UUID(ctx.tenant_id) if ctx.tenant_id else None
            assistant_uuid = UUID(str(assistant_id)) if assistant_id else None
            session_service = ConversationSessionService(ctx.db_session)
            if redis_available:
                message_count = (
                    result.get("last_turn") if isinstance(result, dict) else None
                )
                await session_service.touch_session(
                    session_id=session_uuid,
                    user_id=user_uuid,
                    tenant_id=tenant_uuid,
                    assistant_id=assistant_uuid,
                    channel=ConversationChannel.INTERNAL,
                    message_count=message_count,
                )
            else:
                turn_indexes = await session_service.reserve_turn_indexes(
                    session_id=session_uuid,
                    user_id=user_uuid,
                    tenant_id=tenant_uuid,
                    assistant_id=assistant_uuid,
                    channel=ConversationChannel.INTERNAL,
                    count=len(db_messages),
                )
                for msg, turn_index in zip(db_messages, turn_indexes, strict=False):
                    msg["turn_index"] = turn_index
            try:
                message_repo = ConversationMessageRepository(ctx.db_session)
                await message_repo.bulk_insert_messages(
                    session_id=session_uuid,
                    messages=db_messages,
                )
            except Exception as exc:
                logger.warning(
                    "conversation_message_persist_failed session=%s exc=%s",
                    session_id,
                    exc,
                )
        except Exception as exc:
            logger.warning(
                "conversation_session_touch_failed session=%s exc=%s",
                session_id,
                exc,
            )
    elif not redis_available:
        logger.warning(
            "conversation_append_db_unavailable session=%s trace=%s",
            session_id,
            ctx.trace_id,
        )

    if conv_service:
        await _maybe_schedule_topic_naming(
            ctx=ctx,
            conv_service=conv_service,
            session_id=session_id,
            messages=user_messages,
            appended_count=len(db_messages),
            last_turn=result.get("last_turn") if isinstance(result, dict) else None,
        )


async def _maybe_schedule_topic_naming(
    *,
    ctx: WorkflowContext,
    conv_service: ConversationService,
    session_id: str,
    messages: list[dict[str, Any]],
    appended_count: int,
    last_turn: int | None,
) -> None:
    if not ctx.user_id:
        return
    if not last_turn or last_turn != appended_count:
        return
    first_message = extract_first_user_message(messages)
    if not first_message:
        return
    first_message = first_message[:1000]

    meta_key = CacheKeys.conversation_meta(session_id)
    try:
        existing = await conv_service.redis.hget(meta_key, TOPIC_NAMING_META_KEY)
        if isinstance(existing, (bytes, bytearray)):
            existing = existing.decode()
        if existing and str(existing) not in ("0", ""):
            return
        await conv_service._redis_hset(meta_key, {TOPIC_NAMING_META_KEY: 1})
    except Exception:
        return

    try:
        from app.tasks.conversation import conversation_topic_naming

        conversation_topic_naming.delay(
            session_id=session_id,
            user_id=str(ctx.user_id),
            first_message=first_message,
        )
    except Exception as exc:
        logger.warning(
            "conversation_topic_naming_schedule_failed session=%s exc=%s",
            session_id,
            exc,
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
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BanditReportResponse:
    """
    Bandit 臂观测报表（内部通道，仅登录用户可见）。
    """

    repo = BanditRepository(db)
    items = await repo.get_report(capability=capability, model=model)

    total_trials = sum(i.get("total_trials", 0) for i in items) or 0
    total_successes = sum(i.get("successes", 0) for i in items) or 0
    overall_success_rate = (total_successes / total_trials) if total_trials else 0.0

    summary = BanditReportSummary(
        total_arms=len(items),
        total_trials=total_trials,
        overall_success_rate=overall_success_rate,
    )

    return BanditReportResponse(summary=summary, items=items)


@router.get(
    "/debug/step-registry",
    response_model=StepRegistryResponse,
)
async def step_registry_debug(
    user: User = Depends(get_current_user),
) -> StepRegistryResponse:
    return StepRegistryResponse(steps=step_registry.list_all())


@router.post(
    "/debug/test-routing",
    response_model=RoutingTestResponse | GatewayError,
)
async def test_routing(
    request: Request,
    request_body: RoutingTestRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RoutingTestResponse | JSONResponse:
    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        capability=request_body.capability,
        requested_model=request_body.model,
        db_session=db,
        tenant_id=str(user.id) if user else None,
        user_id=str(user.id) if user else None,
        api_key_id=str(user.id) if user else None,
        trace_id=getattr(request.state, "trace_id", None) if request else None,
    )
    ctx.set("request", "base_url", str(request.base_url).rstrip("/") if request else None)
    ctx.set("validation", "request", request_body)
    ctx.set("routing", "require_provider_model_id", True)
    if request_body.request_id:
        ctx.set("request", "request_id", request_body.request_id)

    orchestrator = GatewayOrchestrator(workflow_config=INTERNAL_DEBUG_WORKFLOW)
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

    instance_id = ctx.get("routing", "instance_id")
    provider_model_id = ctx.get("routing", "provider_model_id")
    return RoutingTestResponse(
        model=ctx.requested_model or request_body.model,
        capability=ctx.capability or request_body.capability,
        provider=ctx.get("routing", "provider"),
        preset_id=ctx.get("routing", "preset_id"),
        preset_item_id=ctx.get("routing", "preset_item_id"),
        instance_id=str(instance_id) if instance_id is not None else None,
        provider_model_id=str(provider_model_id) if provider_model_id is not None else None,
        upstream_url=ctx.get("routing", "upstream_url"),
        template_engine=ctx.get("routing", "template_engine"),
        routing_config=ctx.get("routing", "routing_config"),
        limit_config=ctx.get("routing", "limit_config"),
        pricing_config=ctx.get("routing", "pricing_config"),
        affinity_hit=ctx.get("routing", "affinity_hit"),
    )


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
    ctx.set("request", "base_url", str(request.base_url).rstrip("/") if request else None)
    if request_body.request_id:
        ctx.set("request", "request_id", request_body.request_id)
    ctx.set("validation", "request", request_body)
    ctx.set("routing", "require_provider_model_id", True)

    if request_body.status_stream:
        return StreamingResponse(
            _status_stream_chat(ctx, orchestrator),
            media_type="text/event-stream",
        )

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
    "/chat/completions/{request_id}/cancel",
    response_model=ChatCompletionCancelResponse,
)
async def cancel_chat_completions(
    request_id: str,
    user: User = Depends(get_current_user),
) -> ChatCompletionCancelResponse:
    req_id = request_id.strip()
    if not req_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid request_id")
    cancel_service = CancelService()
    await cancel_service.mark_cancel(
        capability="chat",
        user_id=str(user.id),
        request_id=req_id,
    )
    return ChatCompletionCancelResponse(request_id=req_id)


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
    ctx.set("request", "base_url", str(request.base_url).rstrip("/") if request else None)
    ctx.set("validation", "request", request_body)
    ctx.set("routing", "require_provider_model_id", True)

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


@router.get("/models", response_model=ModelGroupListResponse)
async def list_models(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    capability: str | None = Query(None, description="能力过滤 (chat/image_generation/embedding 等)"),
) -> ModelGroupListResponse:
    preset_repo = ProviderPresetRepository(db)
    instance_repo = ProviderInstanceRepository(db)
    model_repo = ProviderModelRepository(db)

    logger.info(f"internal_models_list start user_id={user.id}")
    instances = await instance_repo.get_available_instances(user_id=str(user.id), include_public=True)
    if not instances:
        logger.warning(f"internal_models_list empty_instances user_id={user.id}")
        return ModelGroupListResponse(instances=[])

    preset_cache: dict[str, any] = {}
    inst_list = list(instances)
    inst_map = {str(i.id): i for i in inst_list}
    models = await model_repo.list()
    logger.info(
        f"internal_models_list loaded user_id={user.id} "
        f"instances={len(inst_list)} models={len(models)}"
    )

    skipped_missing_instance = 0
    skipped_inactive_model = 0
    skipped_preset_missing = 0
    skipped_preset_inactive = 0
    added_models = 0
    logged_missing_preset_slugs: set[str] = set()
    grouped: dict[str, dict[str, Any]] = {}
    capability_filter = set(expand_capabilities(capability)) if capability else set()
    for m in models:
        # Check if model has any of the requested capabilities
        if capability_filter and not set(m.capabilities).intersection(capability_filter):
            continue
        inst = inst_map.get(str(m.instance_id))
        if not inst:
            skipped_missing_instance += 1
            continue
        if not m.is_active:
            skipped_inactive_model += 1
            continue
        if inst.preset_slug not in preset_cache:
            preset_cache[inst.preset_slug] = await preset_repo.get_by_slug(inst.preset_slug)
        preset = preset_cache.get(inst.preset_slug)
        if not preset:
            skipped_preset_missing += 1
            if inst.preset_slug not in logged_missing_preset_slugs:
                logged_missing_preset_slugs.add(inst.preset_slug)
                logger.warning(
                    f"internal_models_list preset_missing user_id={user.id} "
                    f"instance_id={inst.id} preset_slug={inst.preset_slug} "
                    f"sample_model_id={m.model_id}"
                )
            continue
        if not preset.is_active:
            skipped_preset_inactive += 1
            continue
        icon = inst.icon or preset.icon if hasattr(preset, "icon") else None
        group = grouped.get(str(inst.id))
        if not group:
            group = {
                "instance_id": str(inst.id),
                "instance_name": inst.name,
                "provider": preset.provider,
                "icon": icon,
                "models": [],
            }
            grouped[str(inst.id)] = group
        group["models"].append(
            {
                "id": m.unified_model_id or m.model_id,
                "object": "model",
                "owned_by": preset.provider,
                "icon": icon,
                "upstream_model_id": m.model_id,
                "provider_model_id": str(m.id),
            }
        )
        added_models += 1

    instances_data = [grouped[str(inst.id)] for inst in inst_list if str(inst.id) in grouped]
    if not instances_data:
        logger.warning(
            f"internal_models_list result_empty user_id={user.id} "
            f"instances={len(inst_list)} models={len(models)} "
            f"skipped_missing_instance={skipped_missing_instance} "
            f"skipped_inactive_model={skipped_inactive_model} "
            f"skipped_preset_missing={skipped_preset_missing} "
            f"skipped_preset_inactive={skipped_preset_inactive}"
        )
    else:
        logger.info(
            f"internal_models_list result_ok user_id={user.id} "
            f"instances={len(instances_data)} models={added_models}"
        )
    return ModelGroupListResponse(instances=instances_data)
