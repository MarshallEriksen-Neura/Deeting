from __future__ import annotations

import re
from uuid import UUID

from app.models.assistant import Assistant, AssistantStatus, AssistantVisibility
from app.repositories.assistant_repository import (
    AssistantRepository,
    AssistantVersionRepository,
)
from app.repositories.assistant_tag_repository import AssistantTagRepository, AssistantTagLinkRepository
from app.schemas.assistant import (
    AssistantCreate,
    AssistantUpdate,
    AssistantVersionCreate,
    AssistantVersionUpdate,
    AssistantListResponse,
)
from app.services.assistant.assistant_state import AssistantStateMachine
from app.services.assistant.assistant_tag_service import AssistantTagService
from app.tasks.assistant import remove_assistant_from_qdrant, sync_assistant_to_qdrant
from app.utils.time_utils import Datetime
from app.repositories.assistant_tag_repository import AssistantTagRepository, AssistantTagLinkRepository


class AssistantService:
    """
    助手领域 Service
    - 创建助手及首个版本
    - 更新助手元信息（含状态机）
    - 发布助手（状态迁移 + 可选切换版本）
    - 创建/更新版本
    """

    def __init__(
        self,
        assistant_repo: AssistantRepository,
        version_repo: AssistantVersionRepository,
    ):
        self.assistant_repo = assistant_repo
        self.version_repo = version_repo
        self.tag_service = AssistantTagService(
            AssistantTagRepository(assistant_repo.session),
            AssistantTagLinkRepository(assistant_repo.session),
        )

    async def list_assistants(
        self,
        size: int,
        cursor: str | None = None,
        visibility: str | None = None,
        status: str | None = None,
        owner_user_id=None,
    ) -> AssistantListResponse:
        items, next_cursor = await self.assistant_repo.list_paginated(
            size=size,
            cursor=cursor,
            visibility=visibility,
            status=status,
            owner_user_id=owner_user_id,
        )
        return AssistantListResponse(
            items=items,
            next_cursor=next_cursor,
            size=len(items),
        )

    async def search_public(
        self,
        query: str,
        size: int,
        cursor: str | None = None,
        tags: list[str] | None = None,
    ) -> AssistantListResponse:
        items, next_cursor = await self.assistant_repo.search_public(
            query=query,
            size=size,
            cursor=cursor,
            tags=tags,
        )
        return AssistantListResponse(
            items=items,
            next_cursor=next_cursor,
            size=len(items),
        )

    # ===== 助手 =====
    async def create_assistant(
        self,
        payload: AssistantCreate,
        owner_user_id: UUID | None,
    ) -> Assistant:
        assistant_data = {
            "owner_user_id": owner_user_id,
            "visibility": payload.visibility.value if isinstance(payload.visibility, AssistantVisibility) else payload.visibility,
            "status": payload.status.value if isinstance(payload.status, AssistantStatus) else payload.status,
            "share_slug": payload.share_slug,
            "summary": payload.summary,
            "icon_id": payload.icon_id,
        }
        assistant = await self.assistant_repo.create(assistant_data)

        version = await self._create_version_internal(assistant.id, payload.version)
        await self.tag_service.sync_assistant_tags(assistant.id, version.tags)

        # 设定当前版本
        assistant.current_version_id = version.id

        # 状态机：创建时若需直接发布
        if payload.status == AssistantStatus.PUBLISHED:
            AssistantStateMachine.apply(assistant, AssistantStatus.PUBLISHED)

        assistant = await self.assistant_repo.update(
            assistant,
            {
                "current_version_id": assistant.current_version_id,
                "status": assistant.status,
                "published_at": assistant.published_at,
            },
        )
        return assistant

    async def update_assistant(
        self,
        assistant_id: UUID,
        payload: AssistantUpdate,
    ) -> Assistant:
        assistant = await self.assistant_repo.get(assistant_id)
        if not assistant:
            raise ValueError("助手不存在")

        was_indexable = self._is_indexable(assistant.visibility, assistant.status)
        update_data: dict = {}
        if payload.visibility is not None:
            update_data["visibility"] = (
                payload.visibility.value
                if isinstance(payload.visibility, AssistantVisibility)
                else payload.visibility
            )
        if payload.share_slug is not None:
            update_data["share_slug"] = payload.share_slug
        if payload.summary is not None:
            update_data["summary"] = payload.summary
        if payload.current_version_id is not None:
            update_data["current_version_id"] = payload.current_version_id
        if payload.icon_id is not None:
            update_data["icon_id"] = payload.icon_id

        if payload.status is not None:
            AssistantStateMachine.apply(assistant, payload.status)
            update_data["status"] = assistant.status
            update_data["published_at"] = assistant.published_at

        if payload.version is not None:
            version_payload = await self._prepare_version_payload(assistant, payload.version)
            version = await self._create_version_internal(assistant_id, version_payload)
            await self.tag_service.sync_assistant_tags(assistant_id, version.tags)
            update_data["current_version_id"] = version.id

        assistant = await self.assistant_repo.update(assistant, update_data)
        self._sync_index_if_needed(
            assistant=assistant,
            was_indexable=was_indexable,
            payload=payload,
        )
        return assistant

    async def publish_assistant(
        self,
        assistant_id: UUID,
        version_id: UUID | None = None,
    ) -> Assistant:
        assistant = await self.assistant_repo.get(assistant_id)
        if not assistant:
            raise ValueError("助手不存在")

        if version_id:
            version = await self.version_repo.get_for_assistant(assistant_id, version_id)
            if not version:
                raise ValueError("版本不存在或不属于该助手")
            assistant.current_version_id = version.id

        AssistantStateMachine.apply(assistant, AssistantStatus.PUBLISHED, now=Datetime.now())

        assistant = await self.assistant_repo.update(
            assistant,
            {
                "current_version_id": assistant.current_version_id,
                "status": assistant.status,
                "published_at": assistant.published_at,
            },
        )
        if self._is_indexable(assistant.visibility, assistant.status):
            sync_assistant_to_qdrant.delay(str(assistant.id))
        return assistant

    # ===== 版本 =====
    async def create_version(
        self,
        assistant_id: UUID,
        payload: AssistantVersionCreate,
        set_as_current: bool = True,
    ):
        version = await self._create_version_internal(assistant_id, payload)
        if set_as_current:
            assistant = await self.assistant_repo.get(assistant_id)
            if not assistant:
                raise ValueError("助手不存在")
            assistant.current_version_id = version.id
            await self.assistant_repo.update(
                assistant,
                {"current_version_id": assistant.current_version_id},
            )
        return version

    async def update_version(
        self,
        assistant_id: UUID,
        version_id: UUID,
        payload: AssistantVersionUpdate,
    ):
        version = await self.version_repo.get_for_assistant(assistant_id, version_id)
        if not version:
            raise ValueError("版本不存在或不属于该助手")

        update_data = payload.model_dump(exclude_unset=True, by_alias=True)
        if "tags" in update_data:
            update_data["tags"] = self.tag_service.normalize_tags(update_data.get("tags"))
        # published_at 由外部决定; 此处仅更新提供的字段
        version = await self.version_repo.update(version, update_data)
        if payload.tags is not None:
            await self.tag_service.sync_assistant_tags(assistant_id, payload.tags)
        return version

    async def delete_assistant(self, assistant_id: UUID) -> None:
        assistant = await self.assistant_repo.get(assistant_id)
        if not assistant:
            return
        if self._is_indexable(assistant.visibility, assistant.status):
            remove_assistant_from_qdrant.delay(str(assistant.id))
        await self.assistant_repo.delete(assistant_id)

    # ===== 内部工具 =====
    @staticmethod
    def _bump_semver(version: str) -> str:
        match = re.match(r"^(\d+)\.(\d+)\.(\d+)$", version)
        if not match:
            return "0.1.0"
        major, minor, patch = (int(part) for part in match.groups())
        return f"{major}.{minor}.{patch + 1}"

    async def _prepare_version_payload(
        self,
        assistant: Assistant,
        payload: AssistantVersionCreate,
    ) -> AssistantVersionCreate:
        candidate_version = payload.version if "version" in payload.model_fields_set else None
        if candidate_version:
            existing = await self.version_repo.get_by_semver(assistant.id, candidate_version)
            if not existing:
                return payload

        base_version = "0.1.0"
        if assistant.current_version_id:
            current = await self.version_repo.get_for_assistant(assistant.id, assistant.current_version_id)
            if current and current.version:
                base_version = current.version

        next_version = self._bump_semver(base_version)
        while await self.version_repo.get_by_semver(assistant.id, next_version):
            next_version = self._bump_semver(next_version)

        return payload.model_copy(update={"version": next_version})

    async def _create_version_internal(
        self,
        assistant_id: UUID,
        payload: AssistantVersionCreate,
    ):
        version_data = payload.model_dump(by_alias=True)
        if "tags" in version_data:
            version_data["tags"] = self.tag_service.normalize_tags(version_data.get("tags"))
        version_data["assistant_id"] = assistant_id
        if "published_at" not in version_data:
            version_data["published_at"] = None
        return await self.version_repo.create(version_data)

    @staticmethod
    def _is_indexable(visibility: AssistantVisibility | str, status: AssistantStatus | str) -> bool:
        visibility_value = visibility.value if isinstance(visibility, AssistantVisibility) else visibility
        status_value = status.value if isinstance(status, AssistantStatus) else status
        return (
            visibility_value == AssistantVisibility.PUBLIC.value
            and status_value == AssistantStatus.PUBLISHED.value
        )

    def _sync_index_if_needed(
        self,
        *,
        assistant: Assistant,
        was_indexable: bool,
        payload: AssistantUpdate,
    ) -> None:
        is_indexable = self._is_indexable(assistant.visibility, assistant.status)
        if was_indexable and not is_indexable:
            remove_assistant_from_qdrant.delay(str(assistant.id))
            return
        if not is_indexable:
            return
        if (
            not was_indexable
            or payload.version is not None
            or payload.summary is not None
            or payload.current_version_id is not None
        ):
            sync_assistant_to_qdrant.delay(str(assistant.id))
