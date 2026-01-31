import uuid

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, Mock

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import User
from app.models.review import ReviewStatus, ReviewTask
from app.repositories import ReviewTaskRepository
from app.services.assistant.assistant_auto_review_service import AutoReviewResult
from app.services.assistant.assistant_market_service import ASSISTANT_MARKET_ENTITY
from app.services.assistant.assistant_review_service import AssistantReviewService
from app.services.review.review_service import ReviewService

engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:",
    echo=False,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(User.__table__.create)
        await conn.run_sync(ReviewTask.__table__.create)
    yield
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(ReviewTask.__table__.drop)
        await conn.run_sync(User.__table__.drop)


@pytest_asyncio.fixture
async def async_session():
    async with AsyncSessionLocal() as session:
        yield session


@pytest.mark.asyncio
async def test_review_approved_enqueues_sync(monkeypatch, async_session):
    user = User(
        id=uuid.uuid4(),
        email="reviewer@example.com",
        hashed_password="hash",
    )
    async_session.add(user)
    await async_session.commit()

    assistant_id = uuid.uuid4()

    review_service = ReviewService(ReviewTaskRepository(async_session))
    service = AssistantReviewService(
        review_service=review_service,
        auto_review_service=Mock(),
    )

    monkeypatch.setattr(
        service,
        "auto_review",
        AsyncMock(
            return_value=AutoReviewResult(
                status=ReviewStatus.APPROVED,
                reviewer_user_id=user.id,
                reason=None,
            ),
        ),
    )
    enqueue = Mock()
    monkeypatch.setattr("app.tasks.assistant.sync_assistant_to_qdrant.delay", enqueue)

    await service.submit_and_review(
        assistant_id=assistant_id,
        submitter_user_id=user.id,
    )

    enqueue.assert_called_once_with(str(assistant_id))


@pytest.mark.asyncio
async def test_review_rejected_skips_sync(monkeypatch, async_session):
    user = User(
        id=uuid.uuid4(),
        email="reject@example.com",
        hashed_password="hash",
    )
    async_session.add(user)
    await async_session.commit()

    assistant_id = uuid.uuid4()

    review_service = ReviewService(ReviewTaskRepository(async_session))
    service = AssistantReviewService(
        review_service=review_service,
        auto_review_service=Mock(),
    )

    monkeypatch.setattr(
        service,
        "auto_review",
        AsyncMock(
            return_value=AutoReviewResult(
                status=ReviewStatus.REJECTED,
                reviewer_user_id=user.id,
                reason="bad",
            ),
        ),
    )
    enqueue = Mock()
    monkeypatch.setattr("app.tasks.assistant.sync_assistant_to_qdrant.delay", enqueue)

    await service.submit_and_review(
        assistant_id=assistant_id,
        submitter_user_id=user.id,
    )

    enqueue.assert_not_called()
    task = await ReviewTaskRepository(async_session).get_by_entity(ASSISTANT_MARKET_ENTITY, assistant_id)
    assert task is not None
    assert task.status == ReviewStatus.REJECTED.value


@pytest.mark.asyncio
async def test_review_auto_review_error_marks_rejected(monkeypatch, async_session):
    user = User(
        id=uuid.uuid4(),
        email="error@example.com",
        hashed_password="hash",
    )
    async_session.add(user)
    await async_session.commit()

    assistant_id = uuid.uuid4()

    review_service = ReviewService(ReviewTaskRepository(async_session))
    service = AssistantReviewService(
        review_service=review_service,
        auto_review_service=Mock(),
    )

    monkeypatch.setattr(
        service,
        "auto_review",
        AsyncMock(side_effect=ValueError("auto review failed")),
    )

    await service.submit_and_review(
        assistant_id=assistant_id,
        submitter_user_id=user.id,
    )

    task = await ReviewTaskRepository(async_session).get_by_entity(ASSISTANT_MARKET_ENTITY, assistant_id)
    assert task is not None
    assert task.status == ReviewStatus.REJECTED.value
    assert task.reason == "auto review failed"
