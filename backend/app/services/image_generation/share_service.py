from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi_pagination.ext.sqlalchemy import paginate
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_generation import ImageGenerationStatus
from app.repositories.generation_task_repository import GenerationTaskRepository
from app.repositories.image_generation_output_repository import ImageGenerationOutputRepository
from app.repositories.image_generation_share_repository import ImageGenerationShareRepository
from app.repositories.assistant_tag_repository import AssistantTagRepository
from app.repositories.image_generation_share_tag_repository import (
    ImageGenerationShareTagLinkRepository,
)
from app.repositories.media_asset_repository import MediaAssetRepository
from app.schemas.image_generation import (
    ImageGenerationOutputItem,
    ImageGenerationShareDetail,
    ImageGenerationShareItem,
    ImageGenerationShareState,
)
from app.services.image_generation.service import ImageGenerationService
from app.services.image_generation.share_tag_service import ImageGenerationShareTagService
from app.utils.time_utils import Datetime


class ImageGenerationShareService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.task_repo = GenerationTaskRepository(session)
        self.output_repo = ImageGenerationOutputRepository(session)
        self.asset_repo = MediaAssetRepository(session)
        self.share_repo = ImageGenerationShareRepository(session)
        self.tag_repo = AssistantTagRepository(session)
        self.share_tag_repo = ImageGenerationShareTagLinkRepository(session)
        self.share_tag_service = ImageGenerationShareTagService(
            self.tag_repo, self.share_tag_repo
        )

    async def share_task(
        self,
        *,
        user_id: UUID,
        task_id: UUID,
        tags: list[str] | None = None,
    ) -> ImageGenerationShareState:
        task = await self.task_repo.get(task_id)
        if not task or task.user_id != user_id:
            raise ValueError("task not found")
        if _status_value(task.status) != ImageGenerationStatus.SUCCEEDED.value:
            raise ValueError("task not succeeded")

        outputs = await self.output_repo.list_by_task(task_id)
        if not outputs:
            raise ValueError("task has no outputs")

        now = Datetime.now()
        prompt_encrypted = bool(task.prompt_encrypted)
        prompt_value = None if prompt_encrypted else task.prompt_raw

        payload: dict[str, Any] = {
            "task_id": task.id,
            "user_id": user_id,
            "model": task.model,
            "prompt": prompt_value,
            "prompt_encrypted": prompt_encrypted,
            "width": task.width,
            "height": task.height,
            "num_outputs": task.num_outputs,
            "steps": task.steps,
            "cfg_scale": task.cfg_scale,
            "seed": task.seed,
            "shared_at": now,
            "revoked_at": None,
            "is_active": True,
        }

        share = await self.share_repo.get_by_task_id(task.id)
        if share:
            await self.share_repo.update_fields(share.id, payload, commit=True)
            share = await self.share_repo.get(share.id)
        else:
            share = await self.share_repo.create(payload, commit=True)

        if tags is not None:
            normalized = await self.share_tag_service.sync_share_tags(share.id, tags)
        else:
            normalized = []
            tag_map = await self.share_tag_service.list_tags_for_shares([share.id])
            normalized = tag_map.get(share.id, [])

        return ImageGenerationShareState(
            share_id=share.id,
            task_id=share.task_id,
            is_active=bool(share.is_active),
            shared_at=share.shared_at,
            revoked_at=share.revoked_at,
            prompt_encrypted=bool(share.prompt_encrypted),
            tags=normalized,
        )

    async def unshare_task(self, *, user_id: UUID, task_id: UUID) -> ImageGenerationShareState | None:
        share = await self.share_repo.get_by_task_id(task_id)
        if not share or share.user_id != user_id:
            return None

        if share.is_active:
            await self.share_repo.update_fields(
                share.id,
                {"is_active": False, "revoked_at": Datetime.now()},
                commit=True,
            )
            share = await self.share_repo.get(share.id)

        tag_map = await self.share_tag_service.list_tags_for_shares([share.id])
        tags = tag_map.get(share.id, [])
        return ImageGenerationShareState(
            share_id=share.id,
            task_id=share.task_id,
            is_active=bool(share.is_active),
            shared_at=share.shared_at,
            revoked_at=share.revoked_at,
            prompt_encrypted=bool(share.prompt_encrypted),
            tags=tags,
        )

    async def list_public_shares(
        self,
        *,
        params: CursorParams,
        base_url: str | None,
    ) -> CursorPage[ImageGenerationShareItem]:
        stmt = self.share_repo.build_public_query()

        async def _transform(rows):
            shares = list(rows)
            preview_map = await self._build_share_previews(shares, base_url)
            items: list[ImageGenerationShareItem] = []
            tag_map = await self.share_tag_service.list_tags_for_shares(
                [share.id for share in shares]
            )
            for share in shares:
                items.append(
                    ImageGenerationShareItem(
                        share_id=share.id,
                        task_id=share.task_id,
                        model=share.model,
                        prompt=share.prompt,
                        prompt_encrypted=bool(share.prompt_encrypted),
                        width=share.width,
                        height=share.height,
                        num_outputs=share.num_outputs,
                        steps=share.steps,
                        cfg_scale=share.cfg_scale,
                        seed=share.seed,
                        shared_at=share.shared_at,
                        tags=tag_map.get(share.id, []),
                        preview=preview_map.get(share.task_id),
                    )
                )
            return items

        return await paginate(self.session, stmt, params=params, transformer=_transform)

    async def get_public_share_detail(
        self,
        *,
        share_id: UUID,
        base_url: str | None,
    ) -> ImageGenerationShareDetail | None:
        share = await self.share_repo.get_active_by_id(share_id)
        if not share:
            return None
        outputs = await ImageGenerationService(self.session).build_signed_outputs(
            share.task_id,
            base_url=base_url,
        )
        tag_map = await self.share_tag_service.list_tags_for_shares([share.id])
        return ImageGenerationShareDetail(
            share_id=share.id,
            task_id=share.task_id,
            model=share.model,
            prompt=share.prompt,
            prompt_encrypted=bool(share.prompt_encrypted),
            width=share.width,
            height=share.height,
            num_outputs=share.num_outputs,
            steps=share.steps,
            cfg_scale=share.cfg_scale,
            seed=share.seed,
            shared_at=share.shared_at,
            tags=tag_map.get(share.id, []),
            outputs=outputs,
        )

    async def _build_share_previews(
        self,
        shares: list[Any],
        base_url: str | None,
    ) -> dict[UUID, ImageGenerationOutputItem | None]:
        task_ids = [share.task_id for share in shares if share.is_active]
        if not task_ids:
            return {}

        outputs = await self.output_repo.list_by_task_ids(task_ids)
        first_outputs = {}
        for output in outputs:
            if output.task_id not in first_outputs:
                first_outputs[output.task_id] = output

        asset_ids = [output.media_asset_id for output in first_outputs.values() if output.media_asset_id]
        assets = await self.asset_repo.list_by_ids(asset_ids)
        asset_map = {asset.id: asset for asset in assets}

        from app.services.oss.asset_storage_service import build_signed_asset_url

        now = Datetime.now()
        preview_map: dict[UUID, ImageGenerationOutputItem | None] = {}
        for task_id, output in first_outputs.items():
            asset_url = None
            if output.media_asset_id:
                asset = asset_map.get(output.media_asset_id)
                if asset:
                    expire_at = asset.expire_at
                    if expire_at and expire_at.tzinfo is None:
                        from datetime import UTC
                        expire_at = expire_at.replace(tzinfo=UTC)
                    if not expire_at or expire_at > now:
                        asset_url = build_signed_asset_url(asset.object_key, base_url=base_url)
            preview_map[task_id] = ImageGenerationOutputItem(
                output_index=output.output_index,
                asset_url=asset_url,
                source_url=output.source_url,
                seed=output.seed,
                content_type=output.content_type,
                size_bytes=output.size_bytes,
                width=output.width,
                height=output.height,
            )
        return preview_map


def _status_value(status: ImageGenerationStatus | str | None) -> str:
    if isinstance(status, ImageGenerationStatus):
        return status.value
    if status is None:
        return ""
    return str(status)


__all__ = ["ImageGenerationShareService"]
