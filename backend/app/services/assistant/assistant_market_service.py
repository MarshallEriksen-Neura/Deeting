from __future__ import annotations

from uuid import UUID

from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi_pagination.ext.sqlalchemy import paginate

from app.models.assistant import Assistant, AssistantStatus, AssistantVisibility
from app.models.notification import NotificationLevel, NotificationType
from app.models.review import ReviewStatus
from app.repositories.assistant_repository import AssistantRepository, AssistantVersionRepository
from app.repositories.assistant_install_repository import AssistantInstallRepository
from app.repositories.assistant_market_repository import AssistantMarketRepository
from app.repositories.assistant_tag_repository import AssistantTagLinkRepository, AssistantTagRepository
from app.repositories.review_repository import ReviewTaskRepository
from app.schemas.assistant_market import (
    AssistantInstallItem,
    AssistantInstallUpdate,
    AssistantMarketItem,
    AssistantSummary,
    AssistantSummaryVersion,
)
from app.services.review.review_service import ReviewService
from app.services.notifications.notification_service import NotificationService
from app.services.assistant.assistant_auto_review_service import AssistantAutoReviewService, AutoReviewResult
from app.services.assistant.assistant_tag_service import AssistantTagService

ASSISTANT_MARKET_ENTITY = "assistant_market"


async def ensure_assistant_access(
    *,
    assistant: Assistant,
    user_id: UUID,
    review_repo: ReviewTaskRepository,
    action: str,
) -> None:
    if assistant.owner_user_id == user_id:
        return
    visibility = assistant.visibility.value if isinstance(assistant.visibility, AssistantVisibility) else assistant.visibility
    status = assistant.status.value if isinstance(assistant.status, AssistantStatus) else assistant.status
    if visibility != AssistantVisibility.PUBLIC.value:
        raise ValueError(f"助手未公开，无法{action}")
    if status != AssistantStatus.PUBLISHED.value:
        raise ValueError(f"助手未发布，无法{action}")

    if assistant.owner_user_id is None:
        return

    review = await review_repo.get_by_entity(ASSISTANT_MARKET_ENTITY, assistant.id)
    review_status = review.status.value if review and isinstance(review.status, ReviewStatus) else (review.status if review else None)
    if not review or review_status != ReviewStatus.APPROVED.value:
        raise ValueError(f"助手未通过审核，无法{action}")


class AssistantMarketService:
    def __init__(
        self,
        assistant_repo: AssistantRepository,
        install_repo: AssistantInstallRepository,
        review_repo: ReviewTaskRepository,
        market_repo: AssistantMarketRepository,
        auto_review_service: AssistantAutoReviewService | None = None,
    ):
        self.assistant_repo = assistant_repo
        self.install_repo = install_repo
        self.review_repo = review_repo
        self.market_repo = market_repo
        self.review_service = ReviewService(review_repo)
        self.auto_review_service = auto_review_service
        self.notification_service = NotificationService(assistant_repo.session)
        self.tag_service = AssistantTagService(
            AssistantTagRepository(assistant_repo.session),
            AssistantTagLinkRepository(assistant_repo.session),
        )

    async def list_market(
        self,
        *,
        user_id: UUID | None,
        params: CursorParams,
        query: str | None = None,
        tags: list[str] | None = None,
    ) -> CursorPage[AssistantMarketItem]:
        normalized_tags = self.tag_service.normalize_tags(tags)
        stmt = self.market_repo.build_market_query(
            user_id=user_id,
            entity_type=ASSISTANT_MARKET_ENTITY,
            query=query,
            tags=normalized_tags,
        )

        async def _transform(rows):
            items: list[AssistantMarketItem] = []
            assistant_ids = [assistant.id for assistant, _, _ in rows]
            tag_map = await self.tag_service.list_tags_for_assistants(assistant_ids)
            for assistant, version, install_id in rows:
                summary = AssistantSummaryVersion(
                    id=version.id,
                    version=version.version,
                    name=version.name,
                    description=version.description,
                    tags=version.tags,
                    published_at=version.published_at,
                )
                items.append(
                    AssistantMarketItem(
                        assistant_id=assistant.id,
                        owner_user_id=assistant.owner_user_id,
                        icon_id=assistant.icon_id,
                        share_slug=assistant.share_slug,
                        summary=assistant.summary,
                        published_at=assistant.published_at,
                        current_version_id=assistant.current_version_id,
                        install_count=assistant.install_count,
                        rating_avg=assistant.rating_avg,
                        rating_count=assistant.rating_count,
                        tags=tag_map.get(assistant.id, []),
                        version=summary,
                        installed=install_id is not None,
                    )
                )
            return items

        return await paginate(self.market_repo.session, stmt, params=params, transformer=_transform)

    async def list_installs(
        self,
        *,
        user_id: UUID,
        params: CursorParams,
    ) -> CursorPage[AssistantInstallItem]:
        stmt = self.market_repo.build_install_query(user_id=user_id)

        async def _transform(rows):
            items: list[AssistantInstallItem] = []
            assistant_ids = [assistant.id for _, assistant, _ in rows]
            tag_map = await self.tag_service.list_tags_for_assistants(assistant_ids)
            for install, assistant, version in rows:
                summary = AssistantSummary(
                    assistant_id=assistant.id,
                    owner_user_id=assistant.owner_user_id,
                    icon_id=assistant.icon_id,
                    share_slug=assistant.share_slug,
                    summary=assistant.summary,
                    published_at=assistant.published_at,
                    current_version_id=assistant.current_version_id,
                    install_count=assistant.install_count,
                    rating_avg=assistant.rating_avg,
                    rating_count=assistant.rating_count,
                    tags=tag_map.get(assistant.id, []),
                    version=AssistantSummaryVersion(
                        id=version.id,
                        version=version.version,
                        name=version.name,
                        description=version.description,
                        tags=version.tags,
                        published_at=version.published_at,
                    ),
                )
                items.append(
                    AssistantInstallItem(
                        id=install.id,
                        created_at=install.created_at,
                        updated_at=install.updated_at,
                        user_id=install.user_id,
                        assistant_id=install.assistant_id,
                        alias=install.alias,
                        icon_override=install.icon_override,
                        pinned_version_id=install.pinned_version_id,
                        follow_latest=install.follow_latest,
                        is_enabled=install.is_enabled,
                        sort_order=install.sort_order,
                        assistant=summary,
                    )
                )
            return items

        return await paginate(self.market_repo.session, stmt, params=params, transformer=_transform)

    async def install_assistant(self, *, user_id: UUID, assistant_id: UUID) -> AssistantInstallItem:
        assistant = await self.assistant_repo.get(assistant_id)
        if not assistant:
            raise ValueError("助手不存在")

        await self._ensure_installable(assistant, user_id)

        existing = await self.install_repo.get_by_user_and_assistant(user_id, assistant_id)
        if existing:
            await self._refresh_install_count(assistant_id)
            return await self._load_install_item(existing.id, user_id)

        install = await self.install_repo.create(
            {
                "user_id": user_id,
                "assistant_id": assistant_id,
            }
        )
        await self._refresh_install_count(assistant_id)
        return await self._load_install_item(install.id, user_id)

    async def uninstall_assistant(self, *, user_id: UUID, assistant_id: UUID) -> None:
        existing = await self.install_repo.get_by_user_and_assistant(user_id, assistant_id)
        if not existing:
            return
        await self.install_repo.delete(existing.id)
        await self._refresh_install_count(assistant_id)

    async def update_install(
        self,
        *,
        user_id: UUID,
        assistant_id: UUID,
        payload: AssistantInstallUpdate,
    ) -> AssistantInstallItem:
        install = await self.install_repo.get_by_user_and_assistant(user_id, assistant_id)
        if not install:
            raise ValueError("安装记录不存在")

        update_data = payload.model_dump(exclude_unset=True)
        if payload.pinned_version_id is not None:
            version_repo = AssistantVersionRepository(self.assistant_repo.session)
            version = await version_repo.get_for_assistant(assistant_id, payload.pinned_version_id)
            if not version:
                raise ValueError("锁定版本不存在或不属于该助手")
            if payload.follow_latest is None:
                update_data["follow_latest"] = False

        if payload.follow_latest is True:
            update_data["pinned_version_id"] = None

        install = await self.install_repo.update(install, update_data)
        return await self._load_install_item(install.id, user_id)

    async def submit_for_review(
        self,
        *,
        user_id: UUID,
        assistant_id: UUID,
        payload: dict | None = None,
    ) -> AutoReviewResult | None:
        assistant = await self.assistant_repo.get(assistant_id)
        if not assistant:
            raise ValueError("助手不存在")
        if assistant.owner_user_id != user_id:
            raise ValueError("无权限提交该助手")
        visibility = assistant.visibility.value if isinstance(assistant.visibility, AssistantVisibility) else assistant.visibility
        status = assistant.status.value if isinstance(assistant.status, AssistantStatus) else assistant.status
        if visibility != AssistantVisibility.PUBLIC.value:
            raise ValueError("请先将助手设置为 public 可见")
        if status != AssistantStatus.PUBLISHED.value:
            raise ValueError("请先将助手状态设置为 published")

        await self.review_service.submit(
            entity_type=ASSISTANT_MARKET_ENTITY,
            entity_id=assistant_id,
            submitter_user_id=user_id,
            payload=payload,
        )
        if not self.auto_review_service:
            return None

        result = await self.auto_review_service.auto_review(assistant_id)
        if result.status == ReviewStatus.APPROVED:
            await self.review_service.approve(
                entity_type=ASSISTANT_MARKET_ENTITY,
                entity_id=assistant_id,
                reviewer_user_id=result.reviewer_user_id,
                reason=result.reason,
            )
            await self._notify_review_result(
                assistant_id=assistant_id,
                user_id=user_id,
                status=result.status,
                reason=result.reason,
            )
        elif result.status == ReviewStatus.REJECTED:
            await self.review_service.reject(
                entity_type=ASSISTANT_MARKET_ENTITY,
                entity_id=assistant_id,
                reviewer_user_id=result.reviewer_user_id,
                reason=result.reason,
            )
            await self._notify_review_result(
                assistant_id=assistant_id,
                user_id=user_id,
                status=result.status,
                reason=result.reason,
            )
        return result

    async def approve_review(
        self,
        *,
        assistant_id: UUID,
        reviewer_user_id: UUID | None,
        reason: str | None = None,
    ):
        task = await self.review_service.approve(
            entity_type=ASSISTANT_MARKET_ENTITY,
            entity_id=assistant_id,
            reviewer_user_id=reviewer_user_id,
            reason=reason,
        )
        await self._notify_review_result(
            assistant_id=assistant_id,
            user_id=task.submitter_user_id,
            status=ReviewStatus.APPROVED,
            reason=reason,
        )
        return task

    async def reject_review(
        self,
        *,
        assistant_id: UUID,
        reviewer_user_id: UUID | None,
        reason: str | None = None,
    ):
        task = await self.review_service.reject(
            entity_type=ASSISTANT_MARKET_ENTITY,
            entity_id=assistant_id,
            reviewer_user_id=reviewer_user_id,
            reason=reason,
        )
        await self._notify_review_result(
            assistant_id=assistant_id,
            user_id=task.submitter_user_id,
            status=ReviewStatus.REJECTED,
            reason=reason,
        )
        return task

    async def _notify_review_result(
        self,
        *,
        assistant_id: UUID,
        user_id: UUID | None,
        status: ReviewStatus,
        reason: str | None = None,
    ) -> None:
        if not user_id:
            return
        if status not in {ReviewStatus.APPROVED, ReviewStatus.REJECTED}:
            return

        assistant = await self.assistant_repo.get(assistant_id)
        if not assistant or not assistant.current_version_id:
            return

        version_repo = AssistantVersionRepository(self.assistant_repo.session)
        version = await version_repo.get_for_assistant(assistant_id, assistant.current_version_id)
        assistant_name = version.name if version else "助手"

        if status == ReviewStatus.APPROVED:
            title = "助手审核通过"
            content = f"你的助手「{assistant_name}」已通过审核，现已上架市场。"
            level = NotificationLevel.INFO
        else:
            title = "助手审核未通过"
            reason_text = reason or "请根据提示修改后重新提交"
            content = f"你的助手「{assistant_name}」未通过审核：{reason_text}"
            level = NotificationLevel.WARN

        await self.notification_service.publish_to_user(
            user_id=user_id,
            title=title,
            content=content,
            notification_type=NotificationType.SYSTEM,
            level=level,
            payload={
                "assistant_id": str(assistant_id),
                "status": status.value,
                "reason": reason,
            },
            source="assistant_review",
        )

    async def _ensure_installable(self, assistant: Assistant, user_id: UUID) -> None:
        await ensure_assistant_access(
            assistant=assistant,
            user_id=user_id,
            review_repo=self.review_repo,
            action="安装",
        )

    async def _refresh_install_count(self, assistant_id: UUID) -> None:
        count = await self.install_repo.count_by_assistant(assistant_id)
        assistant = await self.assistant_repo.get(assistant_id)
        if not assistant:
            return
        await self.assistant_repo.update(assistant, {"install_count": count})

    async def _load_install_item(self, install_id: UUID, user_id: UUID) -> AssistantInstallItem:
        stmt = self.market_repo.build_install_query(user_id=user_id, install_id=install_id)
        result = await self.market_repo.session.execute(stmt)
        row = result.first()
        if not row:
            raise ValueError("安装记录不存在")
        install, assistant, version = row
        summary = AssistantSummary(
            assistant_id=assistant.id,
            owner_user_id=assistant.owner_user_id,
            icon_id=assistant.icon_id,
            share_slug=assistant.share_slug,
            summary=assistant.summary,
            published_at=assistant.published_at,
            current_version_id=assistant.current_version_id,
            install_count=assistant.install_count,
            rating_avg=assistant.rating_avg,
            rating_count=assistant.rating_count,
            tags=(await self.tag_service.list_tags_for_assistants([assistant.id])).get(assistant.id, []),
            version=AssistantSummaryVersion(
                id=version.id,
                version=version.version,
                name=version.name,
                description=version.description,
                tags=version.tags,
                published_at=version.published_at,
            ),
        )
        return AssistantInstallItem(
            id=install.id,
            created_at=install.created_at,
            updated_at=install.updated_at,
            user_id=install.user_id,
            assistant_id=install.assistant_id,
            alias=install.alias,
            icon_override=install.icon_override,
            pinned_version_id=install.pinned_version_id,
            follow_latest=install.follow_latest,
            is_enabled=install.is_enabled,
            sort_order=install.sort_order,
            assistant=summary,
        )
