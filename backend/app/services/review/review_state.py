"""
通用审核状态机：集中管理审核流转规则。
"""

from __future__ import annotations

from datetime import datetime

from app.models.review import ReviewStatus, ReviewTask
from app.utils.time_utils import Datetime

ALLOWED_TRANSITIONS: dict[ReviewStatus, set[ReviewStatus]] = {
    ReviewStatus.DRAFT: {ReviewStatus.PENDING},
    ReviewStatus.PENDING: {ReviewStatus.APPROVED, ReviewStatus.REJECTED, ReviewStatus.SUSPENDED},
    ReviewStatus.REJECTED: {ReviewStatus.PENDING},
    ReviewStatus.APPROVED: {ReviewStatus.SUSPENDED, ReviewStatus.PENDING},
    ReviewStatus.SUSPENDED: {ReviewStatus.PENDING},
}


def _normalize(status: ReviewStatus | str) -> ReviewStatus:
    return status if isinstance(status, ReviewStatus) else ReviewStatus(status)


class ReviewStateMachine:
    @staticmethod
    def validate_transition(current: ReviewStatus | str, target: ReviewStatus | str) -> None:
        current_enum = _normalize(current)
        target_enum = _normalize(target)
        if current_enum == target_enum:
            return
        allowed = ALLOWED_TRANSITIONS.get(current_enum, set())
        if target_enum not in allowed:
            raise ValueError(f"审核状态不允许从 {current_enum} 迁移到 {target_enum}")

    @staticmethod
    def apply(
        task: ReviewTask,
        target: ReviewStatus | str,
        now: datetime | None = None,
    ) -> ReviewTask:
        current_enum = _normalize(task.status)
        target_enum = _normalize(target)

        ReviewStateMachine.validate_transition(current_enum, target_enum)
        if current_enum == target_enum:
            return task

        task.status = target_enum.value
        ts = now or Datetime.now()
        if target_enum == ReviewStatus.PENDING:
            task.submitted_at = ts
            task.reviewed_at = None
        elif target_enum in {ReviewStatus.APPROVED, ReviewStatus.REJECTED, ReviewStatus.SUSPENDED}:
            task.reviewed_at = ts
        return task
