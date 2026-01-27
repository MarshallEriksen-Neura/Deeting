from __future__ import annotations

import base64
import hashlib
import logging
from datetime import timedelta
from typing import Any
from uuid import UUID
from urllib.parse import urlparse

import httpx
from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi_pagination.ext.sqlalchemy import paginate
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.http_client import create_async_http_client
from app.models.image_generation import (
    GenerationTaskType,
    ImageGenerationStatus as VideoGenerationStatus, # Reuse Status Enum
)
from app.models.video_generation import VideoGenerationOutput
from app.repositories.video_generation_output_repository import VideoGenerationOutputRepository
from app.repositories.generation_task_repository import GenerationTaskRepository
from app.repositories.media_asset_repository import MediaAssetRepository
from app.repositories.provider_instance_repository import ProviderModelRepository
from app.schemas.video_generation import VideoGenerationOutputItem, VideoGenerationTaskListItem
from app.services.system import CancelService
from app.services.image_generation.prompt_security import PromptCipher, build_prompt_hash
from app.services.oss.asset_storage_service import store_asset_bytes
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import get_internal_orchestrator
from app.utils.time_utils import Datetime

logger = logging.getLogger(__name__)

DEFAULT_ASSET_TTL_DAYS = 90
DEFAULT_VIDEO_CONTENT_TYPE = "video/mp4"


class VideoGenerationService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.task_repo = GenerationTaskRepository(session)
        self.output_repo = VideoGenerationOutputRepository(session)
        self.asset_repo = MediaAssetRepository(session)
        self.model_repo = ProviderModelRepository(session)
        self.prompt_cipher = PromptCipher()
        self.cancel_service = CancelService()

    async def create_task(self, payload: dict[str, Any]) -> tuple[Any, bool]:
        request_id = payload.get("request_id")
        user_id = payload.get("user_id")
        if request_id and user_id:
            existing = await self.task_repo.get_by_request_id(
                user_id=user_id,
                request_id=request_id,
            )
            if existing:
                return existing, True

        prompt = payload.get("prompt_raw") or ""
        negative_prompt = payload.get("negative_prompt")
        payload["prompt_hash"] = build_prompt_hash(prompt, negative_prompt)
        payload.setdefault("task_type", GenerationTaskType.VIDEO_GENERATION)
        
        # Populate input_params from payload for generation
        if not payload.get("input_params"):
            payload["input_params"] = {
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "image_url": payload.get("image_url"),
                "width": payload.get("width"),
                "height": payload.get("height"),
                "aspect_ratio": payload.get("aspect_ratio"),
                "duration": payload.get("duration"),
                "fps": payload.get("fps"),
                "motion_bucket_id": payload.get("motion_bucket_id"),
                "num_outputs": payload.get("num_outputs"),
                "steps": payload.get("steps"),
                "cfg_scale": payload.get("cfg_scale"),
                "seed": payload.get("seed"),
                "quality": payload.get("quality"),
                "style": payload.get("style"),
                "extra_params": payload.get("extra_params") or {},
            }

        if payload.get("prompt_encrypted"):
            ciphertext = self.prompt_cipher.encrypt(prompt)
            if ciphertext:
                payload["prompt_ciphertext"] = ciphertext
            else:
                payload["prompt_encrypted"] = False
                payload["prompt_ciphertext"] = None

        task = await self.task_repo.create(payload, commit=True)
        return task, False

    async def process_task(self, task_id) -> None:
        task = await self.task_repo.get(task_id)
        if not task:
            return
        if await self._maybe_cancel_task(task):
            return
        if _status_value(task.status) not in (
            VideoGenerationStatus.QUEUED.value,
            VideoGenerationStatus.RUNNING.value,
        ):
            return

        await self.task_repo.update_status(
            task.id,
            status=VideoGenerationStatus.RUNNING,
            started_at=Datetime.now(),
            commit=True,
        )

        request = _build_request_from_task(task)
        provider_model = None
        if task.provider_model_id:
            provider_model = await self.model_repo.get(task.provider_model_id)

        capability = "video_generation"
        if provider_model and provider_model.capabilities:
            capability = (
                "video_generation"
                if "video_generation" in provider_model.capabilities
                else provider_model.capabilities[0]
            )
        ctx = WorkflowContext(
            channel=Channel.INTERNAL,
            capability=capability,
            requested_model=task.model,
            db_session=self.session,
            tenant_id=str(task.user_id) if task.user_id else None,
            user_id=str(task.user_id) if task.user_id else None,
            api_key_id=str(task.api_key_id) if task.api_key_id else None,
            trace_id=task.trace_id,
        )
        ctx.set("validation", "request", request)
        ctx.set("routing", "require_provider_model_id", True)

        orchestrator = get_internal_orchestrator()
        result = await orchestrator.execute(ctx)

        if await self._is_task_canceled(task.id):
            return

        if not result.success or not ctx.is_success:
            await self.task_repo.update_fields(
                task.id,
                {
                    "status": VideoGenerationStatus.FAILED,
                    "error_code": ctx.error_code or "VIDEO_GENERATION_FAILED",
                    "error_message": ctx.error_message or "upstream failed",
                    "completed_at": Datetime.now(),
                },
                commit=True,
            )
            return

        response = (
            ctx.get("response_transform", "response")
            or ctx.get("upstream_call", "response")
            or {}
        )

        outputs = await self._persist_outputs(task, response)
        if not outputs:
            await self.task_repo.update_fields(
                task.id,
                {
                    "status": VideoGenerationStatus.FAILED,
                    "error_code": "VIDEO_NO_OUTPUT",
                    "error_message": "no video outputs received",
                    "completed_at": Datetime.now(),
                },
                commit=True,
            )
            return

        pricing = ctx.get("routing", "pricing_config") or {}
        cost_user = ctx.billing.total_cost or 0.0
        cost_upstream = cost_user
        currency = ctx.billing.currency

        # Basic cost estimation fallback if needed, specific to video
        if cost_user == 0.0 and pricing.get("video"):
             # Simple per-second or per-generation logic could go here
             pass

        await self.task_repo.update_fields(
            task.id,
            {
                "status": VideoGenerationStatus.SUCCEEDED,
                "provider_model_id": ctx.get("routing", "provider_model_id"),
                "provider_instance_id": ctx.get("routing", "instance_id"),
                "preset_id": ctx.get("routing", "preset_id"),
                "provider": ctx.get("routing", "provider"),
                "input_tokens": ctx.billing.input_tokens or 0,
                "output_tokens": ctx.billing.output_tokens or 0,
                "media_tokens": ctx.billing.total_tokens or 0,
                "cost_user": cost_user,
                "cost_upstream": cost_upstream,
                "currency": currency,
                "completed_at": Datetime.now(),
            },
            commit=True,
        )

    async def cancel_task(self, task_id) -> Any | None:
        task = await self.task_repo.get(task_id)
        if not task:
            return None
        status_value = _status_value(task.status)
        if status_value in (
            VideoGenerationStatus.SUCCEEDED.value,
            VideoGenerationStatus.FAILED.value,
            VideoGenerationStatus.CANCELED.value,
        ):
            return task
        await self.task_repo.update_fields(
            task.id,
            {
                "status": VideoGenerationStatus.CANCELED,
                "completed_at": Datetime.now(),
            },
            commit=True,
        )
        return await self.task_repo.get(task.id)

    async def _maybe_cancel_task(self, task) -> bool:
        status_value = _status_value(task.status)
        if status_value == VideoGenerationStatus.CANCELED.value:
            return True
        if status_value in (
            VideoGenerationStatus.SUCCEEDED.value,
            VideoGenerationStatus.FAILED.value,
        ):
            return False
        if not task.request_id or not task.user_id:
            return False
        if await self.cancel_service.consume_cancel(
            capability="video_generation",
            user_id=str(task.user_id),
            request_id=str(task.request_id),
        ):
            await self.task_repo.update_fields(
                task.id,
                {
                    "status": VideoGenerationStatus.CANCELED,
                    "completed_at": Datetime.now(),
                },
                commit=True,
            )
            return True
        return False

    async def _is_task_canceled(self, task_id) -> bool:
        task = await self.task_repo.get(task_id)
        if not task:
            return False
        return await self._maybe_cancel_task(task)
    
    async def list_outputs(self, task_id) -> list[VideoGenerationOutput]:
        return await self.output_repo.list_by_task(task_id)

    async def build_signed_outputs(self, task_id, base_url: str | None) -> list[dict[str, Any]]:
        outputs = await self.output_repo.list_by_task(task_id)
        result: list[dict[str, Any]] = []
        
        asset_ids = []
        for output in outputs:
            if output.media_asset_id:
                asset_ids.append(output.media_asset_id)
            if output.cover_media_asset_id:
                asset_ids.append(output.cover_media_asset_id)
                
        assets = await self.asset_repo.list_by_ids(asset_ids)
        asset_map = {asset.id: asset for asset in assets}
        
        from app.services.oss.asset_storage_service import build_signed_asset_url
        now = Datetime.now()
        
        for output in outputs:
            asset_url = None
            cover_url = None
            
            if output.media_asset_id:
                asset = asset_map.get(output.media_asset_id)
                if asset:
                    if not asset.expire_at or asset.expire_at > now:
                        asset_url = build_signed_asset_url(asset.object_key, base_url=base_url)

            if output.cover_media_asset_id:
                asset = asset_map.get(output.cover_media_asset_id)
                if asset:
                    if not asset.expire_at or asset.expire_at > now:
                        cover_url = build_signed_asset_url(asset.object_key, base_url=base_url)

            result.append(
                {
                    "output_index": output.output_index,
                    "asset_url": asset_url,
                    "cover_url": cover_url,
                    "source_url": output.source_url,
                    "seed": output.seed,
                    "content_type": output.content_type,
                    "size_bytes": output.size_bytes,
                    "width": output.width,
                    "height": output.height,
                    "duration": output.duration,
                    "fps": output.fps,
                }
            )
        return result

    async def list_user_tasks(
        self,
        *,
        user_id: UUID,
        params: CursorParams,
        status: VideoGenerationStatus | None = None,
        session_id: UUID | None = None,
        include_outputs: bool = True,
        base_url: str | None = None,
    ) -> CursorPage[VideoGenerationTaskListItem]:
        stmt = self.task_repo.build_user_query(
            user_id=user_id,
            status=status,
            session_id=session_id,
            task_type=GenerationTaskType.VIDEO_GENERATION,
        )

        async def _transform(rows):
            tasks = list(rows)
            preview_map: dict[UUID, VideoGenerationOutputItem | None] = {}
            if include_outputs:
                preview_map = await self._build_task_previews(tasks, base_url)
            items: list[VideoGenerationTaskListItem] = []
            for task in tasks:
                prompt_value = None if task.prompt_encrypted else task.prompt_raw
                items.append(
                    VideoGenerationTaskListItem(
                        task_id=task.id,
                        status=_status_value(task.status),
                        model=task.model,
                        session_id=task.session_id,
                        prompt=prompt_value,
                        prompt_encrypted=bool(task.prompt_encrypted),
                        created_at=task.created_at,
                        updated_at=task.updated_at,
                        completed_at=task.completed_at,
                        error_code=task.error_code,
                        error_message=task.error_message,
                        preview=preview_map.get(task.id),
                    )
                )
            return items

        return await paginate(self.task_repo.session, stmt, params=params, transformer=_transform)

    async def _build_task_previews(
        self,
        tasks: list[Any],
        base_url: str | None,
    ) -> dict[UUID, VideoGenerationOutputItem | None]:
        task_ids = [
            task.id
            for task in tasks
            if _status_value(task.status) == VideoGenerationStatus.SUCCEEDED.value
        ]
        if not task_ids:
            return {}

        outputs = await self.output_repo.list_by_task_ids(task_ids)
        first_outputs: dict[UUID, VideoGenerationOutput] = {}
        for output in outputs:
            if output.task_id not in first_outputs:
                first_outputs[output.task_id] = output

        asset_ids = []
        for output in first_outputs.values():
            if output.media_asset_id:
                asset_ids.append(output.media_asset_id)
            if output.cover_media_asset_id:
                asset_ids.append(output.cover_media_asset_id)
                
        assets = await self.asset_repo.list_by_ids(asset_ids)
        asset_map = {asset.id: asset for asset in assets}

        from app.services.oss.asset_storage_service import build_signed_asset_url

        now = Datetime.now()
        preview_map: dict[UUID, VideoGenerationOutputItem | None] = {}
        for task_id, output in first_outputs.items():
            asset_url = None
            cover_url = None
            
            if output.media_asset_id:
                asset = asset_map.get(output.media_asset_id)
                if asset:
                     if not asset.expire_at or asset.expire_at > now:
                        asset_url = build_signed_asset_url(asset.object_key, base_url=base_url)
            
            if output.cover_media_asset_id:
                asset = asset_map.get(output.cover_media_asset_id)
                if asset:
                     if not asset.expire_at or asset.expire_at > now:
                        cover_url = build_signed_asset_url(asset.object_key, base_url=base_url)

            preview_map[task_id] = VideoGenerationOutputItem(
                output_index=output.output_index,
                asset_url=asset_url,
                cover_url=cover_url,
                source_url=output.source_url,
                seed=output.seed,
                content_type=output.content_type,
                size_bytes=output.size_bytes,
                width=output.width,
                height=output.height,
                duration=output.duration,
            )
        return preview_map

    async def _persist_outputs(self, task, response: dict[str, Any]) -> list[VideoGenerationOutput]:
        items = _extract_items(response)
        outputs: list[VideoGenerationOutput] = []
        for index, item in enumerate(items):
            asset = await self._store_item(item, uploader_user_id=task.user_id)
            cover_asset = None
            if item.get("cover_url") or item.get("cover_b64"):
                cover_asset = await self._store_item(
                    {
                        "url": item.get("cover_url"),
                        "b64": item.get("cover_b64"),
                        "content_type": "image/jpeg"
                    }, 
                    uploader_user_id=task.user_id
                )

            output_payload = {
                "task_id": task.id,
                "output_index": index,
                "media_asset_id": asset.get("asset_id") if asset else None,
                "cover_media_asset_id": cover_asset.get("asset_id") if cover_asset else None,
                "source_url": asset.get("source_url") if asset else None,
                "seed": item.get("seed"),
                "content_type": asset.get("content_type") if asset else None,
                "size_bytes": asset.get("size_bytes") if asset else None,
                "width": item.get("width"),
                "height": item.get("height"),
                "duration": item.get("duration"),
                "fps": item.get("fps"),
                "meta": item.get("meta") or {},
            }
            output = await self.output_repo.create(output_payload, commit=False)
            outputs.append(output)

        for output in outputs:
            await self.session.refresh(output)
        return outputs

    async def _store_item(
        self,
        item: dict[str, Any],
        *,
        uploader_user_id: Any | None = None,
    ) -> dict[str, Any] | None:
        if not isinstance(item, dict):
            return None

        b64_data = item.get("b64_json") or item.get("b64")
        source_url = item.get("url")

        if b64_data:
            raw = _decode_base64(b64_data)
            if raw is None:
                return None
            content_type = item.get("content_type") or DEFAULT_VIDEO_CONTENT_TYPE
            return await self._store_bytes(
                raw,
                content_type=content_type,
                source_url=None,
                uploader_user_id=uploader_user_id,
            )

        if source_url:
            fetched = await _fetch_content(source_url)
            if not fetched:
                return {
                    "asset_id": None,
                    "content_type": None,
                    "size_bytes": None,
                    "source_url": source_url,
                }
            raw, content_type = fetched
            return await self._store_bytes(
                raw,
                content_type=content_type,
                source_url=source_url,
                uploader_user_id=uploader_user_id,
            )

        return None

    async def _store_bytes(
        self,
        data: bytes,
        *,
        content_type: str,
        source_url: str | None,
        uploader_user_id: Any | None,
    ) -> dict[str, Any] | None:
        if not data:
            return None
        if settings.MAX_RESPONSE_BYTES and len(data) > settings.MAX_RESPONSE_BYTES:
            return None
        content_hash = hashlib.sha256(data).hexdigest()
        size_bytes = len(data)

        existing = await self.asset_repo.get_by_hash(content_hash, size_bytes)
        if existing:
            return {
                "asset_id": existing.id,
                "content_type": existing.content_type,
                "size_bytes": existing.size_bytes,
                "source_url": source_url,
            }

        stored = await store_asset_bytes(
            data,
            content_type=content_type,
            kind="generated/videos",
        )

        expire_at = Datetime.now() + timedelta(days=DEFAULT_ASSET_TTL_DAYS)
        asset = await self.asset_repo.create_asset(
            {
                "content_hash": content_hash,
                "size_bytes": size_bytes,
                "content_type": stored.content_type,
                "object_key": stored.object_key,
                "etag": None,
                "uploader_user_id": uploader_user_id,
                "expire_at": expire_at,
            },
            commit=True,
        )
        return {
            "asset_id": asset.id,
            "content_type": asset.content_type,
            "size_bytes": asset.size_bytes,
            "source_url": source_url,
        }


def _status_value(status: VideoGenerationStatus | str | None) -> str:
    if isinstance(status, VideoGenerationStatus):
        return status.value
    if status is None:
        return ""
    return str(status)


def _build_request_from_task(task) -> Any:
    from app.schemas.video_generation import VideoGenerationTaskCreateRequest

    params = task.input_params or {}
    return VideoGenerationTaskCreateRequest(
        model=task.model,
        prompt=task.prompt_raw,
        negative_prompt=task.negative_prompt,
        image_url=params.get("image_url"),
        width=task.width,
        height=task.height,
        aspect_ratio=task.aspect_ratio,
        duration=params.get("duration"),
        fps=params.get("fps"),
        motion_bucket_id=params.get("motion_bucket_id"),
        num_outputs=task.num_outputs,
        steps=task.steps,
        cfg_scale=task.cfg_scale,
        seed=task.seed,
        quality=task.quality,
        style=task.style,
        extra_params=task.extra_params,
        provider_model_id=task.provider_model_id,
        session_id=str(task.session_id) if task.session_id else None,
        request_id=task.request_id,
        encrypt_prompt=task.prompt_encrypted,
    )


def _extract_items(response: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(response, dict):
        return []
    for key in ("data", "videos", "outputs"):
        items = response.get(key)
        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]
    return []


def _decode_base64(raw: str) -> bytes | None:
    try:
        if "," in raw and raw.strip().lower().startswith("data:"):
            raw = raw.split(",", 1)[1]
        return base64.b64decode(raw)
    except Exception:
        return None


async def _fetch_content(url: str) -> tuple[bytes, str] | None:
    parsed = urlparse(url)
    if not parsed.scheme.startswith("http"):
        return None
    timeout = httpx.Timeout(60.0) # Longer timeout for video
    async with create_async_http_client(timeout=timeout) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
        except Exception as exc:
            logger.warning("fetch_content_error url=%s error=%s", url, exc)
            return None
        data = resp.content or b""
        if settings.MAX_RESPONSE_BYTES and len(data) > settings.MAX_RESPONSE_BYTES:
            logger.warning("fetch_content_too_large url=%s size=%d", url, len(data))
            return None
        content_type = resp.headers.get("content-type") or DEFAULT_VIDEO_CONTENT_TYPE
        return data, content_type


__all__ = ["VideoGenerationService"]
