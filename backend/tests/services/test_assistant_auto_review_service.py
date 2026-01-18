import uuid

import pytest
import pytest_asyncio

from app.models import Base, User
from app.models.secretary import UserSecretary
from app.models.review import ReviewStatus
from app.models.assistant import AssistantStatus, AssistantVisibility
from app.repositories import (
    AssistantRepository,
    AssistantVersionRepository,
    UserRepository,
    UserSecretaryRepository,
)
from app.schemas.assistant import AssistantCreate, AssistantVersionCreate
from app.services.assistant.assistant_auto_review_service import AssistantAutoReviewService
from app.services.assistant.assistant_service import AssistantService
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_auto_review_build_request_uses_superuser_secretary():
    async with AsyncSessionLocal() as session:
        superuser = User(
            id=uuid.uuid4(),
            email="superuser@example.com",
            hashed_password="hash",
            is_superuser=True,
        )
        session.add(superuser)
        await session.commit()

        secretary = UserSecretary(
            user_id=superuser.id,
            model_name="gpt-4",
        )
        session.add(secretary)
        await session.commit()

        assistant_service = AssistantService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
        )
        system_prompt = "You are a helpful assistant."
        assistant = await assistant_service.create_assistant(
            payload=AssistantCreate(
                visibility=AssistantVisibility.PUBLIC,
                status=AssistantStatus.PUBLISHED,
                version=AssistantVersionCreate(
                    name="Review Assistant",
                    system_prompt=system_prompt,
                    tags=["Python"],
                ),
            ),
            owner_user_id=superuser.id,
        )

        auto_review_service = AssistantAutoReviewService(
            assistant_repo=AssistantRepository(session),
            user_repo=UserRepository(session),
            secretary_repo=UserSecretaryRepository(session),
            version_repo=AssistantVersionRepository(session),
        )

        request, reviewer_id = await auto_review_service.build_review_request(assistant.id)
        assert reviewer_id == superuser.id
        assert request.model == "gpt-4"
        assert system_prompt in (request.messages[1].content or "")


def test_auto_review_parse_decision():
    content = '```json\n{"decision":"approve","reason":"ok"}\n```'
    decision, reason = AssistantAutoReviewService.parse_review_decision(content)
    assert decision == ReviewStatus.APPROVED
    assert reason == "ok"
