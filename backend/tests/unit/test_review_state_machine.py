import uuid

import pytest

from app.models.review import ReviewStatus, ReviewTask
from app.services.review.review_state import ReviewStateMachine


def test_review_state_machine_transitions():
    task = ReviewTask(
        id=uuid.uuid4(),
        entity_type="assistant_market",
        entity_id=uuid.uuid4(),
        status=ReviewStatus.DRAFT.value,
    )

    ReviewStateMachine.apply(task, ReviewStatus.PENDING)
    assert task.status == ReviewStatus.PENDING.value

    ReviewStateMachine.apply(task, ReviewStatus.APPROVED)
    assert task.status == ReviewStatus.APPROVED.value

    with pytest.raises(ValueError):
        ReviewStateMachine.apply(task, ReviewStatus.REJECTED)
