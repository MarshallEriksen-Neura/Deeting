"""
会话管理接口（内部通道）

功能：
- 删除指定消息（软删除）
- 重新生成上一轮回复（基于现有窗口重新调用编排器）
- 一键清空上下文窗口
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.schemas.gateway import ChatCompletionRequest, ChatCompletionResponse, GatewayError
from app.services.conversation.service import ConversationService
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import (
    GatewayOrchestrator,
    get_internal_orchestrator,
)

router = APIRouter(tags=["Conversations"])


class RegenerateRequest(BaseModel):
    model: str
    temperature: float | None = None
    max_tokens: int | None = None


class ClearResponse(BaseModel):
    session_id: str
    cleared: bool = True


class DeleteResponse(BaseModel):
    session_id: str
    turn_index: int
    deleted: bool


def _build_error(ctx: WorkflowContext) -> JSONResponse:
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


@router.delete(
    "/conversations/{session_id}/messages/{turn_index}",
    response_model=DeleteResponse,
)
async def delete_message(
    session_id: str,
    turn_index: int,
    user: User = Depends(get_current_user),
) -> DeleteResponse:
    svc = ConversationService()
    result = await svc.delete_message(session_id, turn_index)
    return DeleteResponse(
        session_id=session_id,
        turn_index=turn_index,
        deleted=bool(result.get("deleted")),
    )


@router.post(
    "/conversations/{session_id}/clear",
    response_model=ClearResponse,
)
async def clear_conversation(
    session_id: str,
    user: User = Depends(get_current_user),
) -> ClearResponse:
    svc = ConversationService()
    await svc.clear_session(session_id)
    return ClearResponse(session_id=session_id, cleared=True)


@router.post(
    "/conversations/{session_id}/regenerate",
    response_model=ChatCompletionResponse | GatewayError,
)
async def regenerate_last_reply(
    session_id: str,
    req: RegenerateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    orchestrator: GatewayOrchestrator = Depends(get_internal_orchestrator),
) -> JSONResponse:
    svc = ConversationService()
    window = await svc.load_window(session_id)
    messages: list[dict[str, Any]] = window.get("messages", []) or []
    summary = window.get("summary")

    # 找到最后一条用户消息
    user_msgs = [m for m in messages if m.get("role") == "user"]
    if not user_msgs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No user message found")
    last_user = max(user_msgs, key=lambda m: m.get("turn_index", 0))

    # 如果最后一条助手回复存在，先软删除以便重新生成
    assistant_after = sorted(
        [
            m
            for m in messages
            if m.get("role") == "assistant" and m.get("turn_index", 0) > last_user.get("turn_index", 0)
        ],
        key=lambda m: m.get("turn_index", 0),
    )
    if assistant_after:
        await svc.delete_message(session_id, assistant_after[0].get("turn_index"))

    # 构建请求：复用已有窗口，避免重复写入用户消息，messages 留空，由 conversation_load 注入
    chat_req = ChatCompletionRequest(
        model=req.model,
        messages=[],
        stream=False,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
        session_id=session_id,
    )

    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        capability="chat",
        requested_model=req.model,
        db_session=db,
        tenant_id=str(user.id) if user else None,
        user_id=str(user.id) if user else None,
        trace_id=getattr(request.state, "trace_id", None) if request else None,
    )
    ctx.set("validation", "request", chat_req)
    ctx.set("conversation", "session_id", session_id)

    # 将 summary 透传到上下文，避免 conversation_load 重复构造
    if summary:
        ctx.set("conversation", "summary", summary)

    result = await orchestrator.execute(ctx)
    if not result.success or not ctx.is_success:
        return _build_error(ctx)

    response_body = ctx.get("response_transform", "response")
    status_code = ctx.get("upstream_call", "status_code") or 200
    return JSONResponse(content=response_body, status_code=status_code)
