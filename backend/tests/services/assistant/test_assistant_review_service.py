import uuid

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock

from app.models import Base, User
from app.models.assistant import AssistantStatus, AssistantVisibility
from app.repositories import (
    AssistantRepository,
    AssistantVersionRepository,
    ReviewTaskRepository,
    UserRepository,
    UserSecretaryRepository,
)
from app.schemas.assistant import AssistantCreate, AssistantVersionCreate
from app.services.assistant.assistant_auto_review_service import AutoReviewResult, AssistantAutoReviewService
from app.services.assistant.assistant_review_service import AssistantReviewService
from app.services.assistant.assistant_service import AssistantService
from app.services.review.review_service import ReviewService
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def async_session():
    async with AsyncSessionLocal() as session:
        yield session


@pytest.mark.asyncio
async def test_review_approved_enqueues_sync(mocker, async_session):
    user = User(
        id=uuid.uuid4(),
        email="reviewer@example.com",
        hashed_password="hash",
    )
    async_session.add(user)
    await async_session.commit()

    assistant_service = AssistantService(
        AssistantRepository(async_session),
        AssistantVersionRepository(async_session),
    )
    assistant = await assistant_service.create_assistant(
        payload=AssistantCreate(
            visibility=AssistantVisibility.PUBLIC,
            status=AssistantStatus.PUBLISHED,
            version=AssistantVersionCreate(
                name="Review Assistant",
                system_prompt="You are a helpful assistant.",
                tags=["Python"],
            ),
        ),
        owner_user_id=user.id,
    )

    review_service = ReviewService(ReviewTaskRepository(async_session))
    auto_review_service = AssistantAutoReviewService(
        assistant_repo=AssistantRepository(async_session),
        user_repo=UserRepository(async_session),
        secretary_repo=UserSecretaryRepository(async_session),
        version_repo=AssistantVersionRepository(async_session),
    )

    service = AssistantReviewService(
        review_service=review_service,
        auto_review_service=auto_review_service,
    )

    mocker.patch.object(
        service,
        "auto_review",
        new_callable=AsyncMock,
        return_value=AutoReviewResult(approved=True, reason=None),
    )
    enqueue = mocker.patch("app.tasks.assistant.sync_assistant_to_qdrant.delay")

    await service.submit_and_review(
        assistant_id=assistant.id,
        submitter_user_id=user.id,
    )

    enqueue.assert_called_once_with(str(assistant.id))
