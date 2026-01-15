from __future__ import annotations

from uuid import UUID

from app.models.review import ReviewStatus, ReviewTask
from app.repositories.review_repository import ReviewTaskRepository
from app.services.review.review_state import ReviewStateMachine


class ReviewService:
    def __init__(self, review_repo: ReviewTaskRepository):
        self.review_repo = review_repo

    async def get_or_create(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        submitter_user_id: UUID | None = None,
    ) -> ReviewTask:
        task = await self.review_repo.get_by_entity(entity_type, entity_id)
        if task:
            return task
        return await self.review_repo.create(
            {
                "entity_type": entity_type,
                "entity_id": entity_id,
                "submitter_user_id": submitter_user_id,
                "status": ReviewStatus.DRAFT.value,
            }
        )

    async def submit(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        submitter_user_id: UUID | None = None,
        payload: dict | None = None,
    ) -> ReviewTask:
        task = await self.get_or_create(
            entity_type=entity_type,
            entity_id=entity_id,
            submitter_user_id=submitter_user_id,
        )
        ReviewStateMachine.apply(task, ReviewStatus.PENDING)
        update_data = {
            "status": task.status,
            "submitted_at": task.submitted_at,
            "reviewed_at": task.reviewed_at,
            "reviewer_user_id": None,
            "reason": None,
        }
        if submitter_user_id is not None:
            update_data["submitter_user_id"] = submitter_user_id
        if payload is not None:
            update_data["payload"] = payload
        return await self.review_repo.update(task, update_data)

    async def approve(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        reviewer_user_id: UUID | None = None,
        reason: str | None = None,
    ) -> ReviewTask:
        task = await self.review_repo.get_by_entity(entity_type, entity_id)
        if not task:
            raise ValueError("审核任务不存在")
        ReviewStateMachine.apply(task, ReviewStatus.APPROVED)
        return await self.review_repo.update(
            task,
            {
                "status": task.status,
                "reviewed_at": task.reviewed_at,
                "reviewer_user_id": reviewer_user_id,
                "reason": reason,
            },
        )

    async def reject(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        reviewer_user_id: UUID | None = None,
        reason: str | None = None,
    ) -> ReviewTask:
        task = await self.review_repo.get_by_entity(entity_type, entity_id)
        if not task:
            raise ValueError("审核任务不存在")
        ReviewStateMachine.apply(task, ReviewStatus.REJECTED)
        return await self.review_repo.update(
            task,
            {
                "status": task.status,
                "reviewed_at": task.reviewed_at,
                "reviewer_user_id": reviewer_user_id,
                "reason": reason,
            },
        )

    async def suspend(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        reviewer_user_id: UUID | None = None,
        reason: str | None = None,
    ) -> ReviewTask:
        task = await self.review_repo.get_by_entity(entity_type, entity_id)
        if not task:
            raise ValueError("审核任务不存在")
        ReviewStateMachine.apply(task, ReviewStatus.SUSPENDED)
        return await self.review_repo.update(
            task,
            {
                "status": task.status,
                "reviewed_at": task.reviewed_at,
                "reviewer_user_id": reviewer_user_id,
                "reason": reason,
            },
        )
