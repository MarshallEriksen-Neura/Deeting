from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.config import settings
from app.core.database import get_db
from app.deps.auth import get_current_active_user
from app.models import User
from app.schemas.monitor import (
    MonitorStatsResponse,
    MonitorTaskCreate,
    MonitorTaskListResponse,
    MonitorTaskResponse,
    MonitorTaskUpdate,
)
from app.services.monitor_service import MonitorService
from app.tasks.monitor import trigger_reasoning_task

from app.services.feedback.trace_feedback_service import TraceFeedbackService

router = APIRouter(prefix="/monitors", tags=["Monitor"])


def _read_header(request: Request, key: str) -> str | None:
    value = request.headers.get(key)
    if value is None:
        return None
    value = value.strip()
    return value or None


def _build_feishu_signature_candidates(
    *,
    secret: str,
    timestamp: str,
    nonce: str,
    body_text: str,
) -> set[str]:
    payload_candidates = [
        f"{timestamp}{nonce}{body_text}",
        f"{timestamp}{nonce}{secret}{body_text}",
        f"{timestamp}\n{nonce}\n{body_text}",
    ]
    signatures: set[str] = set()
    for payload in payload_candidates:
        digest = hmac.new(
            secret.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        signatures.add(digest.hex())
        signatures.add(base64.b64encode(digest).decode("utf-8"))
        signatures.add(base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("="))
    return signatures


async def _verify_feishu_callback_signature(request: Request, raw_body: bytes) -> None:
    secret = (settings.FEISHU_CALLBACK_SECRET or "").strip()
    if not secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Feishu callback secret not configured")

    timestamp = _read_header(request, "X-Lark-Request-Timestamp") or _read_header(request, "X-Lark-Timestamp")
    nonce = _read_header(request, "X-Lark-Request-Nonce") or _read_header(request, "X-Lark-Nonce")
    signature = _read_header(request, "X-Lark-Signature")

    if not timestamp or not nonce or not signature:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Feishu signature headers")

    try:
        ts = int(timestamp)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Feishu timestamp") from exc

    now = int(time.time())
    if abs(now - ts) > int(settings.FEISHU_CALLBACK_MAX_SKEW_SECONDS):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Feishu callback timestamp expired")

    # 防重放：timestamp + nonce + signature 组合键，仅允许一次。
    replay_key = f"feishu:callback:nonce:{timestamp}:{nonce}:{signature[:16]}"
    accepted = await cache.set(
        replay_key,
        True,
        ex=int(settings.FEISHU_CALLBACK_MAX_SKEW_SECONDS),
        nx=True,
    )
    if accepted is False and getattr(cache, "_redis", None) is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Feishu callback replay detected")

    provided = signature.strip()
    body_text = raw_body.decode("utf-8", errors="ignore")
    candidates = _build_feishu_signature_candidates(
        secret=secret,
        timestamp=timestamp,
        nonce=nonce,
        body_text=body_text,
    )
    if provided not in candidates and provided.lower() not in {c.lower() for c in candidates}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Feishu callback signature")


@router.post("/feishu/callback", include_in_schema=False)
async def handle_feishu_callback(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    接收飞书互动卡片的点击回调。
    """
    raw_body = await request.body()
    await _verify_feishu_callback_signature(request, raw_body)
    try:
        data = json.loads(raw_body.decode("utf-8") or "{}")
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid callback payload") from exc
    
    # 1. 处理飞书 URL 验证 (Challenge)
    if data.get("type") == "url_verification":
        return {"challenge": data.get("challenge")}
        
    action = data.get("action", {})
    if not isinstance(action, dict):
        action = {}
    value = action.get("value", {})
    if not isinstance(value, dict):
        value = {}
    
    event = value.get("event")
    monitor_task_id = value.get("monitor_task_id")
    trace_id = value.get("trace_id")
    dialogue_url = value.get("dialogue_url")
    assistant_id = value.get("assistant_id")
    
    # 2. 逻辑处理
    toast_message = "操作成功"
    
    if event in ("useful", "useless") and trace_id:
        feedback_svc = TraceFeedbackService(db)
        score = 1.0 if event == "useful" else 0.0
        await feedback_svc.record_feedback_by_trace(trace_id, score)
        toast_message = "感谢反馈，AI 策略已进化！"
        
    elif event == "pause" and monitor_task_id:
        service = MonitorService(db)
        try:
            task = await service.task_repo.get(uuid.UUID(monitor_task_id))
            if task:
                await service.pause_task(task.id, task.user_id)
                toast_message = "监控任务已暂停运行。"
            else:
                toast_message = "未找到对应监控任务。"
        except Exception:
            toast_message = "暂停失败，请稍后重试。"
    elif event == "dialogue":
        if isinstance(dialogue_url, str) and dialogue_url.strip():
            toast_message = f"请打开对话: {dialogue_url.strip()}"
        elif assistant_id:
            toast_message = f"请在控制台打开助手对话（assistant_id={assistant_id}）"
        else:
            toast_message = "未找到可用对话入口。"

    # 3. 返回飞书要求的响应格式（弹出 Toast）
    return {
        "toast": {
            "type": "success",
            "content": toast_message
        }
    }


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_monitor(
    request: MonitorTaskCreate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = MonitorService(db)
    try:
        return await service.create_task(
            user_id=user.id,
            title=request.title,
            objective=request.objective,
            cron_expr=request.cron_expr,
            notify_config=request.notify_config,
            allowed_tools=request.allowed_tools,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.get("", response_model=MonitorTaskListResponse)
async def list_monitors(
    skip: int = 0,
    limit: int = 100,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = MonitorService(db)
    return await service.get_user_tasks(user.id, skip, limit)


@router.get("/stats", response_model=MonitorStatsResponse)
async def get_monitor_stats(
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = MonitorService(db)
    return await service.get_task_stats(user.id)


@router.get("/{task_id}", response_model=MonitorTaskResponse)
async def get_monitor(
    task_id: uuid.UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = MonitorService(db)
    task = await service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    if task.get("user_id") != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权限查看此任务")
    return task


@router.patch("/{task_id}", response_model=dict)
async def update_monitor(
    task_id: uuid.UUID,
    request: MonitorTaskUpdate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = MonitorService(db)
    try:
        updates = request.model_dump(exclude_unset=True)
        return await service.update_task(task_id, user.id, **updates)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.post("/{task_id}/pause", response_model=dict)
async def pause_monitor(
    task_id: uuid.UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = MonitorService(db)
    try:
        return await service.pause_task(task_id, user.id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.post("/{task_id}/resume", response_model=dict)
async def resume_monitor(
    task_id: uuid.UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = MonitorService(db)
    try:
        return await service.resume_task(task_id, user.id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.post("/{task_id}/trigger", response_model=dict)
async def trigger_monitor(
    task_id: uuid.UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = MonitorService(db)
    task = await service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    if task.get("user_id") != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权限操作此任务")
    if task.get("status") != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅 active 任务可触发")

    trigger_reasoning_task.delay(str(task_id))
    return {"task_id": task_id, "message": "已提交执行"}


@router.delete("/{task_id}", response_model=dict)
async def delete_monitor(
    task_id: uuid.UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = MonitorService(db)
    try:
        return await service.delete_task(task_id, user.id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.get("/{task_id}/logs", response_model=dict)
async def get_monitor_logs(
    task_id: uuid.UUID,
    skip: int = 0,
    limit: int = 50,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = MonitorService(db)
    task = await service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    if task.get("user_id") != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权限查看此任务")
    return await service.get_execution_logs(task_id, skip, limit)
