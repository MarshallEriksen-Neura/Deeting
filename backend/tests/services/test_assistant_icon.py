import pytest
import pytest_asyncio

from app.models import Base
from app.models.assistant import AssistantStatus, AssistantVisibility
from app.repositories.assistant_repository import AssistantRepository, AssistantVersionRepository
from app.schemas.assistant import AssistantCreate, AssistantUpdate, AssistantVersionCreate
from app.services.assistant.assistant_service import AssistantService
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_assistant_icon_id_persists_on_create_and_update():
    async with AsyncSessionLocal() as session:
        service = AssistantService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
        )

        create_payload = AssistantCreate(
            visibility=AssistantVisibility.PRIVATE,
            status=AssistantStatus.DRAFT,
            share_slug=None,
            icon_id="lucide:bot",
            version=AssistantVersionCreate(
                name="默认助手",
                system_prompt="You are a helpful assistant.",
            ),
        )
        assistant = await service.create_assistant(create_payload, owner_user_id=None)
        assert assistant.icon_id == "lucide:bot"

        update_payload = AssistantUpdate(icon_id="lucide:rocket")
        updated = await service.update_assistant(assistant.id, update_payload)
        assert updated.icon_id == "lucide:rocket"
