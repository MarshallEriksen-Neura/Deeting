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
async def test_update_assistant_creates_new_version():
    async with AsyncSessionLocal() as session:
        service = AssistantService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
        )

        assistant = await service.create_assistant(
            payload=AssistantCreate(
                visibility=AssistantVisibility.PRIVATE,
                status=AssistantStatus.DRAFT,
                version=AssistantVersionCreate(
                    name="版本助手",
                    system_prompt="You are a helpful assistant.",
                    tags=["Python"],
                ),
            ),
            owner_user_id=None,
        )

        original_version_id = assistant.current_version_id
        update_payload = AssistantUpdate(
            version=AssistantVersionCreate(
                name="版本助手 v2",
                system_prompt="You are a newer assistant.",
                tags=["Python", "Debug"],
            )
        )
        updated = await service.update_assistant(assistant.id, update_payload)

        assert updated.current_version_id != original_version_id

        assistant_with_versions = await service.assistant_repo.get_with_versions(assistant.id)
        versions = {version.id: version for version in assistant_with_versions.versions}

        assert len(versions) == 2
        assert versions[original_version_id].system_prompt == "You are a helpful assistant."
        assert versions[updated.current_version_id].system_prompt == "You are a newer assistant."
        assert versions[updated.current_version_id].version != versions[original_version_id].version
