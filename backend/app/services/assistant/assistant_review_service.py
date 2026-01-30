from __future__ import annotations

import logging
from uuid import UUID

from app.models.review import ReviewStatus, ReviewTask
from app.services.assistant.assistant_auto_review_service import AssistantAutoReviewService, AutoReviewResult
from app.services.assistant.assistant_market_service import ASSISTANT_MARKET_ENTITY
from app.services.review.review_service import ReviewService
from app.tasks.assistant import sync_assistant_to_qdrant

logger = logging.getLogger(__name__)


class AssistantReviewService:
    def __init__(
        self,
        *,
        review_service: ReviewService,
        auto_review_service: AssistantAutoReviewService,
    ):
        self.review_service = review_service
        self.auto_review_service = auto_review_service

    async def auto_review(self, assistant_id: UUID) -> AutoReviewResult:
        return await self.auto_review_service.auto_review(assistant_id)

    async def submit_and_review(
        self,
        *,
        assistant_id: UUID,
        submitter_user_id: UUID,
        payload: dict | None = None,
    ) -> ReviewTask:
        task = await self.review_service.submit(
            entity_type=ASSISTANT_MARKET_ENTITY,
            entity_id=assistant_id,
            submitter_user_id=submitter_user_id,
            payload=payload,
        )

        try:
            result = await self.auto_review(assistant_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "assistant_auto_review_failed",
                extra={"assistant_id": str(assistant_id), "error": str(exc)},
            )
            return await self.review_service.reject(
                entity_type=ASSISTANT_MARKET_ENTITY,
                entity_id=assistant_id,
                reviewer_user_id=None,
                reason=str(exc),
            )

        if result.status == ReviewStatus.APPROVED:
            task = await self.review_service.approve(
                entity_type=ASSISTANT_MARKET_ENTITY,
                entity_id=assistant_id,
                reviewer_user_id=result.reviewer_user_id,
                reason=result.reason,
            )
            sync_assistant_to_qdrant.delay(str(assistant_id))
            return task

        if result.status == ReviewStatus.REJECTED:
            return await self.review_service.reject(
                entity_type=ASSISTANT_MARKET_ENTITY,
                entity_id=assistant_id,
                reviewer_user_id=result.reviewer_user_id,
                reason=result.reason,
            )

        return await self.review_service.reject(
            entity_type=ASSISTANT_MARKET_ENTITY,
            entity_id=assistant_id,
            reviewer_user_id=result.reviewer_user_id,
            reason="invalid_review_status",
        )
