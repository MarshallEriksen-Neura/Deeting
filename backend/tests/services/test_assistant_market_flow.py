import uuid

import pytest
import pytest_asyncio
from fastapi_pagination.cursor import CursorParams

from app.models import Base, User
from app.models.assistant import AssistantStatus, AssistantVisibility
from app.repositories import (
    AssistantInstallRepository,
    AssistantMarketRepository,
    AssistantRepository,
    AssistantVersionRepository,
    ReviewTaskRepository,
)
from app.schemas.assistant import AssistantCreate, AssistantVersionCreate
from app.schemas.assistant_market import AssistantInstallUpdate
from app.services.assistant.assistant_market_service import AssistantMarketService, ASSISTANT_MARKET_ENTITY
from app.services.assistant.assistant_service import AssistantService
from app.services.review.review_service import ReviewService
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_market_install_flow_marks_installed():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="market@example.com",
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
                    name="Market Assistant",
                    system_prompt="You are a helpful assistant.",
                    tags=["Python", "Debug"],
                ),
            ),
            owner_user_id=user.id,
        )

        review_service = ReviewService(ReviewTaskRepository(session))
        await review_service.submit(
            entity_type=ASSISTANT_MARKET_ENTITY,
            entity_id=assistant.id,
            submitter_user_id=user.id,
        )
        await review_service.approve(
            entity_type=ASSISTANT_MARKET_ENTITY,
            entity_id=assistant.id,
            reviewer_user_id=user.id,
        )

        market_service = AssistantMarketService(
            AssistantRepository(session),
            AssistantInstallRepository(session),
            ReviewTaskRepository(session),
            AssistantMarketRepository(session),
        )

        page = await market_service.list_market(
            user_id=user.id,
            params=CursorParams(size=10),
        )
        assert page.items[0].installed is False
        assert sorted(page.items[0].tags) == ["#Debug", "#Python"]
        assert page.items[0].install_count == 0

        await market_service.install_assistant(user_id=user.id, assistant_id=assistant.id)

        install_page = await market_service.list_installs(
            user_id=user.id,
            params=CursorParams(size=10),
        )
        assert install_page.items[0].assistant.version.system_prompt == "You are a helpful assistant."

        page_after = await market_service.list_market(
            user_id=user.id,
            params=CursorParams(size=10),
        )
        assert page_after.items[0].installed is True
        assert page_after.items[0].install_count == 1

        install_item = await market_service.update_install(
            user_id=user.id,
            assistant_id=assistant.id,
            payload=AssistantInstallUpdate(
                alias="My Assistant",
                pinned_version_id=assistant.current_version_id,
            ),
        )
        assert install_item.alias == "My Assistant"
        assert install_item.pinned_version_id == assistant.current_version_id
        assert install_item.follow_latest is False
        assert install_item.assistant.version.system_prompt == "You are a helpful assistant."
