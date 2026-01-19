from __future__ import annotations

import asyncio
import json
import uuid
from datetime import timedelta
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.models.image_generation import ImageGenerationStatus
from app.schemas.image_generation import (
    ImageGenerationTaskCreateRequest,
    ImageGenerationTaskCreateResponse,
    ImageGenerationTaskDetail,
)
from app.services.image_generation.service import ImageGenerationService
from app.tasks.image_generation import process_image_generation_task
from app.utils.time_utils import Datetime

router = APIRouter(tags=["Internal Image Generation"])


def _format_sse(payload: dict[str, Any] | str) -> bytes:
    if isinstance(payload, str):
        data = payload
    else:
        data = json.dumps(payload, ensure_ascii=False, default=str)
    return f"data: {data}\n\n".encode("utf-8")


@router.post(
    "/images/generations",
    response_model=ImageGenerationTaskCreateResponse,
)
async def create_image_generation(
    request: Request,
    payload: ImageGenerationTaskCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ImageGenerationTaskCreateResponse:
    if not payload.provider_model_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="provider_model_id is required for internal image generation",
        )

    session_uuid = None
    if payload.session_id:
        try:
            session_uuid = uuid.UUID(payload.session_id)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="invalid session_id") from exc

    service = ImageGenerationService(db)
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
            "width": payload.width,
            "height": payload.height,
            "aspect_ratio": payload.aspect_ratio,
            "num_outputs": payload.num_outputs,
            "steps": payload.steps,
            "cfg_scale": payload.cfg_scale,
            "seed": payload.seed,
            "sampler_name": payload.sampler_name,
            "quality": payload.quality,
            "style": payload.style,
            "response_format": payload.response_format,
            "extra_params": payload.extra_params or {},
            "status": ImageGenerationStatus.QUEUED,
        }
    )

    if not deduped:
        process_image_generation_task.delay(str(task.id))

    return ImageGenerationTaskCreateResponse(
        task_id=task.id,
        status=task.status.value,
        created_at=task.created_at,
        deduped=deduped,
    )


@router.get(
    "/images/generations/{task_id}",
    response_model=ImageGenerationTaskDetail,
)
async def get_image_generation(
    task_id: str,
    request: Request,
    include_outputs: bool = Query(True, description="是否包含输出结果"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ImageGenerationTaskDetail:
    try:
        task_uuid = uuid.UUID(task_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid task_id") from exc

    service = ImageGenerationService(db)
    task = await service.task_repo.get(task_uuid)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="task not found")

    outputs = []
    if include_outputs and task.status == ImageGenerationStatus.SUCCEEDED:
        outputs = await service.build_signed_outputs(
            task.id,
            base_url=str(request.base_url).rstrip("/") if request else None,
        )

    return ImageGenerationTaskDetail(
        task_id=task.id,
        status=task.status.value,
        model=task.model,
        created_at=task.created_at,
        updated_at=task.updated_at,
        completed_at=task.completed_at,
        error_code=task.error_code,
        error_message=task.error_message,
        outputs=outputs,
    )


@router.get("/images/generations/{task_id}/events")
async def stream_image_generation_events(
    task_id: str,
    request: Request,
    poll_interval: float = Query(1.0, gt=0.2, le=10.0, description="轮询间隔（秒）"),
    timeout_seconds: int = Query(300, gt=1, le=3600, description="最大等待秒数"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    try:
        task_uuid = uuid.UUID(task_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid task_id") from exc

    service = ImageGenerationService(db)
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

            if task.status.value != last_status:
                payload: dict[str, Any] = {
                    "type": "status",
                    "task_id": str(task.id),
                    "status": task.status.value,
                    "updated_at": task.updated_at,
                }
                if task.status == ImageGenerationStatus.FAILED:
                    payload["error_code"] = task.error_code
                    payload["error_message"] = task.error_message
                if task.status == ImageGenerationStatus.SUCCEEDED:
                    payload["outputs"] = await service.build_signed_outputs(
                        task.id,
                        base_url=str(request.base_url).rstrip("/") if request else None,
                    )
                yield _format_sse(payload)
                last_status = task.status.value

            if task.status in (
                ImageGenerationStatus.SUCCEEDED,
                ImageGenerationStatus.FAILED,
                ImageGenerationStatus.CANCELED,
            ):
                yield _format_sse("[DONE]")
                return

            if Datetime.now() >= deadline:
                yield _format_sse(
                    {
                        "type": "timeout",
                        "task_id": str(task.id),
                        "status": task.status.value,
                    }
                )
                yield _format_sse("[DONE]")
                return

            await asyncio.sleep(poll_interval)

    return StreamingResponse(_event_stream(), media_type="text/event-stream")


__all__ = ["router"]
