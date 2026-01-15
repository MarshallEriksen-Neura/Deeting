import uuid

import pytest
import pytest_asyncio

from app.models import Base, User
from app.models.assistant import AssistantStatus, AssistantVisibility
from app.repositories import (
    AssistantInstallRepository,
    AssistantRatingRepository,
    AssistantRepository,
    AssistantVersionRepository,
)
from app.schemas.assistant import AssistantCreate, AssistantVersionCreate
from app.services.assistant.assistant_rating_service import AssistantRatingService
from app.services.assistant.assistant_service import AssistantService
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_rate_assistant_upserts_and_updates_avg():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="rating@example.com",
            hashed_password="hash",
        )
        session.add(user)
        await session.commit()

        assistant_service = AssistantService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
        )
        assistant = await assistant_service.create_assistant(
            payload=AssistantCreate(
                visibility=AssistantVisibility.PUBLIC,
                status=AssistantStatus.PUBLISHED,
                icon_id="lucide:bot",
                version=AssistantVersionCreate(
                    name="Rated Assistant",
                    system_prompt="You are a helpful assistant.",
                ),
            ),
            owner_user_id=user.id,
        )

        await AssistantInstallRepository(session).create(
            {
                "user_id": user.id,
                "assistant_id": assistant.id,
            }
        )

        rating_service = AssistantRatingService(
            AssistantRepository(session),
            AssistantInstallRepository(session),
            AssistantRatingRepository(session),
        )

        assistant = await rating_service.rate_assistant(
            user_id=user.id,
            assistant_id=assistant.id,
            rating=5.0,
        )
        assert assistant.rating_count == 1
        assert assistant.rating_avg == 5.0

        assistant = await rating_service.rate_assistant(
            user_id=user.id,
            assistant_id=assistant.id,
            rating=4.0,
        )
        assert assistant.rating_count == 1
        assert assistant.rating_avg == 4.0
