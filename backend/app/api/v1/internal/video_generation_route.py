from __future__ import annotations

import asyncio
import json
import uuid
from datetime import timedelta
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.models.image_generation import ImageGenerationStatus as VideoGenerationStatus
from app.schemas.video_generation import (
    VideoGenerationTaskCreateRequest,
    VideoGenerationTaskCreateResponse,
    VideoGenerationTaskDetail,
    VideoGenerationTaskListItem,
)
from app.services.system import CancelService
from app.services.video_generation.service import VideoGenerationService
from app.tasks.video_generation import generate_video
from app.utils.time_utils import Datetime

router = APIRouter(tags=["Internal Video Generation"])


def _format_sse(payload: dict[str, Any] | str) -> bytes:
    if isinstance(payload, str):
        data = payload
    else:
        data = json.dumps(payload, ensure_ascii=False, default=str)
    return f"data: {data}\n\n".encode("utf-8")


def _status_value(status: VideoGenerationStatus | str | None) -> str:
    if isinstance(status, VideoGenerationStatus):
        return status.value
    if status is None:
        return ""
    return str(status)


@router.post(
    "/videos/generations",
    response_model=VideoGenerationTaskCreateResponse,
)
async def create_video_generation(
    request: Request,
    payload: VideoGenerationTaskCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VideoGenerationTaskCreateResponse:
    if not payload.provider_model_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="provider_model_id is required for internal video generation",
        )

    session_uuid = None
    if payload.session_id:
        try:
            session_uuid = uuid.UUID(payload.session_id)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="invalid session_id") from exc

    service = VideoGenerationService(db)
    task, deduped = await service.create_task(
        {
            "user_id": user.id,
            "tenant_id": user.id,
            "api_key_id": user.id,
            "session_id": session_uuid,
            "request_id": payload.request_id,
            "trace_id": getattr(request.state, "trace_id", None) if request else None,
            "model": payload.model,
            "provider_model_id": payload.provider_model_id,
            "prompt_raw": payload.prompt,
            "negative_prompt": payload.negative_prompt,
            "prompt_encrypted": payload.encrypt_prompt,
            
            # Input Params
            "image_url": payload.image_url,
            "width": payload.width,
            "height": payload.height,
            "aspect_ratio": payload.aspect_ratio,
            "duration": payload.duration,
            "fps": payload.fps,
            "motion_bucket_id": payload.motion_bucket_id,
            "num_outputs": payload.num_outputs,
            "steps": payload.steps,
            "cfg_scale": payload.cfg_scale,
            "seed": payload.seed,
            "quality": payload.quality,
            "style": payload.style,
            "extra_params": payload.extra_params or {},
            
            "status": VideoGenerationStatus.QUEUED,
        }
    )

    if not deduped:
        generate_video.delay(str(task.id))

    return VideoGenerationTaskCreateResponse(
        task_id=task.id,
        status=_status_value(task.status),
        created_at=task.created_at,
        deduped=deduped,
    )


@router.get(
    "/videos/generations",
    response_model=CursorPage[VideoGenerationTaskListItem],
)
async def list_video_generations(
    request: Request,
    params: CursorParams = Depends(),
    status: VideoGenerationStatus | None = Query(default=None),
    include_outputs: bool = Query(True, description="是否包含预览输出"),
    session_id: str | None = Query(default=None, description="会话 ID（可选）"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CursorPage[VideoGenerationTaskListItem]:
    service = VideoGenerationService(db)
    session_uuid = None
    if session_id:
        try:
            session_uuid = uuid.UUID(session_id)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="invalid session_id") from exc
    base_url = str(request.base_url).rstrip("/") if request else None
    return await service.list_user_tasks(
        user_id=user.id,
        params=params,
        status=status,
        session_id=session_uuid,
        include_outputs=include_outputs,
        base_url=base_url,
    )


@router.get(
    "/videos/generations/{task_id}",
    response_model=VideoGenerationTaskDetail,
)
async def get_video_generation(
    task_id: str,
    request: Request,
    include_outputs: bool = Query(True, description="是否包含输出结果"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VideoGenerationTaskDetail:
    try:
        task_uuid = uuid.UUID(task_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid task_id") from exc

    service = VideoGenerationService(db)
    task = await service.task_repo.get(task_uuid)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="task not found")

        outputs = []
        if include_outputs and _status_value(task.status) == VideoGenerationStatus.SUCCEEDED.value:
            outputs = await service.build_signed_outputs(
                task.id,
                base_url=str(request.base_url).rstrip("/") if request else None,
            )
    
        return VideoGenerationTaskDetail(        task_id=task.id,
        status=_status_value(task.status),
        model=task.model,
        created_at=task.created_at,
        updated_at=task.updated_at,
        completed_at=task.completed_at,
        error_code=task.error_code,
        error_message=task.error_message,
        outputs=[], # Placeholder until I fix service
    )

@router.post(
    "/videos/generations/{request_id}/cancel",
)
async def cancel_video_generation(
    request_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    req_id = request_id.strip()
    if not req_id:
        raise HTTPException(status_code=400, detail="invalid request_id")

    cancel_service = CancelService()
    await cancel_service.mark_cancel(
        capability="video_generation",
        user_id=str(user.id),
        request_id=req_id,
    )
    service = VideoGenerationService(db)
    await service.cancel_task_by_request_id(user_id=user.id, request_id=req_id)
    return {"request_id": req_id, "status": "canceled"}


@router.get("/videos/generations/{task_id}/events")
async def stream_video_generation_events(
    task_id: str,
    request: Request,
    poll_interval: float = Query(2.0, gt=0.5, le=10.0, description="轮询间隔（秒）"), # Slower poll for video
    timeout_seconds: int = Query(600, gt=1, le=3600, description="最大等待秒数"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    try:
        task_uuid = uuid.UUID(task_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid task_id") from exc

    service = VideoGenerationService(db)
    task = await service.task_repo.get(task_uuid)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="task not found")

    async def _event_stream() -> AsyncIterator[bytes]:
        deadline = Datetime.now() + timedelta(seconds=timeout_seconds)
        last_status: str | None = None

        while True:
            task = await service.task_repo.get(task_uuid)
            if not task:
                yield _format_sse(
                    {
                        "type": "error",
                        "code": "TASK_NOT_FOUND",
                        "message": "task not found",
                    }
                )
                yield _format_sse("[DONE]")
                return

            status_value = _status_value(task.status)
            if status_value != last_status:
                payload: dict[str, Any] = {
                    "type": "status",
                    "task_id": str(task.id),
                    "status": status_value,
                    "updated_at": task.updated_at,
                }
                if status_value == VideoGenerationStatus.FAILED.value:
                    payload["error_code"] = task.error_code
                    payload["error_message"] = task.error_message
                if status_value == VideoGenerationStatus.SUCCEEDED.value:
                    payload["outputs"] = await service.build_signed_outputs(
                        task.id,
                        base_url=str(request.base_url).rstrip("/") if request else None,
                    )
                yield _format_sse(payload)
                last_status = status_value

            if status_value in (
                VideoGenerationStatus.SUCCEEDED.value,
                VideoGenerationStatus.FAILED.value,
                VideoGenerationStatus.CANCELED.value,
            ):
                yield _format_sse("[DONE]")
                return

            if Datetime.now() >= deadline:
                yield _format_sse(
                    {
                        "type": "timeout",
                        "task_id": str(task.id),
                        "status": status_value,
                    }
                )
                yield _format_sse("[DONE]")
                return

            await asyncio.sleep(poll_interval)

    return StreamingResponse(_event_stream(), media_type="text/event-stream")


__all__ = ["router"]
