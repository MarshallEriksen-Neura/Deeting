from __future__ import annotations

from uuid import UUID

from app.models.assistant import Assistant, AssistantStatus, AssistantVisibility
from app.repositories.assistant_repository import (
    AssistantRepository,
    AssistantVersionRepository,
)
from app.schemas.assistant import (
    AssistantCreate,
    AssistantUpdate,
    AssistantVersionCreate,
    AssistantVersionUpdate,
    AssistantListResponse,
)
from app.services.assistant_state import AssistantStateMachine
from app.utils.time_utils import Datetime


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
        }
        assistant = await self.assistant_repo.create(assistant_data)

        version = await self._create_version_internal(assistant.id, payload.version)

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

        update_data: dict = {}
        if payload.visibility is not None:
            update_data["visibility"] = (
                payload.visibility.value
                if isinstance(payload.visibility, AssistantVisibility)
                else payload.visibility
            )
        if payload.share_slug is not None:
            update_data["share_slug"] = payload.share_slug
        if payload.current_version_id is not None:
            update_data["current_version_id"] = payload.current_version_id

        if payload.status is not None:
            AssistantStateMachine.apply(assistant, payload.status)
            update_data["status"] = assistant.status
            update_data["published_at"] = assistant.published_at

        assistant = await self.assistant_repo.update(assistant, update_data)
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

        update_data = payload.model_dump(exclude_unset=True)
        # published_at 由外部决定; 此处仅更新提供的字段
        version = await self.version_repo.update(version, update_data)
        return version

    # ===== 内部工具 =====
    async def _create_version_internal(
        self,
        assistant_id: UUID,
        payload: AssistantVersionCreate,
    ):
        version_data = payload.model_dump()
        version_data["assistant_id"] = assistant_id
        if "published_at" not in version_data:
            version_data["published_at"] = None
        return await self.version_repo.create(version_data)
