import uuid

import pytest
import pytest_asyncio

from app.constants.assistants import (
    DEFAULT_ASSISTANT_DESCRIPTION,
    DEFAULT_ASSISTANT_ICON_ID,
    DEFAULT_ASSISTANT_NAME,
    DEFAULT_ASSISTANT_SLUG,
    DEFAULT_ASSISTANT_SUMMARY,
    DEFAULT_ASSISTANT_SYSTEM_PROMPT,
    DEFAULT_ASSISTANT_VERSION,
)
from app.models import Base, User
from app.models.assistant import AssistantStatus, AssistantVisibility
from app.repositories import (
    AssistantInstallRepository,
    AssistantRepository,
    AssistantVersionRepository,
)
from app.schemas.assistant import AssistantCreate, AssistantVersionCreate
from app.services.assistant.assistant_service import AssistantService
from app.services.assistant.default_assistant_service import DefaultAssistantService
from app.services.users.user_provisioning_service import UserProvisioningService
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


async def _seed_default_assistant(session):
    assistant_repo = AssistantRepository(session)
    existing = await assistant_repo.get_by_share_slug(DEFAULT_ASSISTANT_SLUG)
    if existing:
        return existing

    assistant_service = AssistantService(
        assistant_repo,
        AssistantVersionRepository(session),
    )
    return await assistant_service.create_assistant(
        payload=AssistantCreate(
            visibility=AssistantVisibility.PRIVATE,
            status=AssistantStatus.PUBLISHED,
            share_slug=DEFAULT_ASSISTANT_SLUG,
            summary=DEFAULT_ASSISTANT_SUMMARY,
            icon_id=DEFAULT_ASSISTANT_ICON_ID,
            version=AssistantVersionCreate(
                version=DEFAULT_ASSISTANT_VERSION,
                name=DEFAULT_ASSISTANT_NAME,
                description=DEFAULT_ASSISTANT_DESCRIPTION,
                system_prompt=DEFAULT_ASSISTANT_SYSTEM_PROMPT,
                tags=[],
            ),
        ),
        owner_user_id=None,
    )


@pytest.mark.asyncio
async def test_default_assistant_installed_on_provision():
    async with AsyncSessionLocal() as session:
        assistant = await _seed_default_assistant(session)

        provisioner = UserProvisioningService(session)
        user = await provisioner.provision_user(
            email="newuser@example.com",
            auth_provider="email_code",
            username="NewUser",
        )

        install_repo = AssistantInstallRepository(session)
        install = await install_repo.get_by_user_and_assistant(user.id, assistant.id)
        assert install is not None


@pytest.mark.asyncio
async def test_default_assistant_service_idempotent():
    async with AsyncSessionLocal() as session:
        assistant = await _seed_default_assistant(session)

        user = User(
            id=uuid.uuid4(),
            email="idempotent@example.com",
            hashed_password="hash",
        )
        session.add(user)
        await session.commit()

        service = DefaultAssistantService(session)
        created = await service.ensure_installed(user.id)
        created_again = await service.ensure_installed(user.id)

        assert created is True
        assert created_again is False

        install_repo = AssistantInstallRepository(session)
        install = await install_repo.get_by_user_and_assistant(user.id, assistant.id)
        assert install is not None
