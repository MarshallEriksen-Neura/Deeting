import uuid

import pytest
import pytest_asyncio

from app.models import Base, User, UserSecretary
from app.models.assistant import AssistantStatus, AssistantVisibility
from app.repositories import (
    AssistantRepository,
    AssistantVersionRepository,
    ReviewTaskRepository,
    UserSecretaryRepository,
)
from app.schemas.assistant import AssistantCreate, AssistantVersionCreate
from app.services.assistant.assistant_preview_service import AssistantPreviewService
from app.services.assistant.assistant_service import AssistantService
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_preview_builds_request_with_secretary_model():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="preview@example.com",
            hashed_password="hash",
        )
        session.add(user)

        secretary = UserSecretary(
            user_id=user.id,
            name="My Secretary",
            model_name="gpt-4o",
        )
        session.add(secretary)
        await session.commit()

        assistant_service = AssistantService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
        )
        assistant = await assistant_service.create_assistant(
            payload=AssistantCreate(
                visibility=AssistantVisibility.PUBLIC,
                status=AssistantStatus.PUBLISHED,
                version=AssistantVersionCreate(
                    name="Preview Assistant",
                    system_prompt="You are the preview assistant.",
                ),
            ),
            owner_user_id=user.id,
        )

        preview_service = AssistantPreviewService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
            ReviewTaskRepository(session),
            UserSecretaryRepository(session),
        )

        req = await preview_service.build_preview_request(
            user_id=user.id,
            assistant_id=assistant.id,
            message="Hello",
            stream=True,
            temperature=0.7,
            max_tokens=128,
        )

        assert req.model == "gpt-4o"
        assert req.messages[0].role == "system"
        assert req.messages[0].content == "You are the preview assistant."
        assert req.messages[1].role == "user"
        assert req.messages[1].content == "Hello"
        assert req.stream is True
        assert req.temperature == 0.7
        assert req.max_tokens == 128


@pytest.mark.asyncio
async def test_preview_requires_secretary_model():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="preview-missing@example.com",
            hashed_password="hash",
        )
        session.add(user)

        secretary = UserSecretary(
            user_id=user.id,
            name="My Secretary",
            model_name=None,
        )
        session.add(secretary)
        await session.commit()

        assistant_service = AssistantService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
        )
        assistant = await assistant_service.create_assistant(
            payload=AssistantCreate(
                visibility=AssistantVisibility.PUBLIC,
                status=AssistantStatus.PUBLISHED,
                version=AssistantVersionCreate(
                    name="Preview Assistant",
                    system_prompt="You are the preview assistant.",
                ),
            ),
            owner_user_id=user.id,
        )

        preview_service = AssistantPreviewService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
            ReviewTaskRepository(session),
            UserSecretaryRepository(session),
        )

        with pytest.raises(ValueError, match="秘书模型未配置"):
            await preview_service.build_preview_request(
                user_id=user.id,
                assistant_id=assistant.id,
                message="Hello",
            )
