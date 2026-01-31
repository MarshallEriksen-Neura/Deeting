import uuid

from unittest.mock import Mock

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.assistant import AssistantStatus, AssistantVisibility
from app.repositories.assistant_repository import AssistantRepository, AssistantVersionRepository
from app.schemas.assistant import AssistantCreate, AssistantUpdate, AssistantVersionCreate
from app.services.assistant.assistant_service import AssistantService
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
        await conn.run_sync(Base.metadata.create_all)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def dispose_engine():
    yield
    await engine.dispose()


@pytest.mark.asyncio
async def test_publish_assistant_enqueues_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    enqueue = Mock()
    monkeypatch.setattr("app.tasks.assistant.sync_assistant_to_qdrant.delay", enqueue)

    async with AsyncSessionLocal() as session:
        service = AssistantService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
        )
        assistant = await service.create_assistant(
            payload=AssistantCreate(
                visibility=AssistantVisibility.PUBLIC,
                status=AssistantStatus.DRAFT,
                version=AssistantVersionCreate(
                    name="Public Assistant",
                    system_prompt="You are a helpful assistant.",
                ),
            ),
            owner_user_id=uuid.uuid4(),
        )

        await service.publish_assistant(assistant.id)

    enqueue.assert_called_once_with(str(assistant.id))


@pytest.mark.asyncio
async def test_update_assistant_unpublish_enqueues_remove(monkeypatch: pytest.MonkeyPatch) -> None:
    enqueue = Mock()
    monkeypatch.setattr("app.tasks.assistant.remove_assistant_from_qdrant.delay", enqueue)

    async with AsyncSessionLocal() as session:
        service = AssistantService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
        )
        assistant = await service.create_assistant(
            payload=AssistantCreate(
                visibility=AssistantVisibility.PUBLIC,
                status=AssistantStatus.PUBLISHED,
                version=AssistantVersionCreate(
                    name="Indexed Assistant",
                    system_prompt="You are a helpful assistant.",
                ),
            ),
            owner_user_id=uuid.uuid4(),
        )

        await service.update_assistant(
            assistant.id,
            AssistantUpdate(visibility=AssistantVisibility.PRIVATE),
        )

    enqueue.assert_called_once_with(str(assistant.id))


@pytest.mark.asyncio
async def test_update_assistant_version_enqueues_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    enqueue = Mock()
    monkeypatch.setattr("app.tasks.assistant.sync_assistant_to_qdrant.delay", enqueue)

    async with AsyncSessionLocal() as session:
        service = AssistantService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
        )
        assistant = await service.create_assistant(
            payload=AssistantCreate(
                visibility=AssistantVisibility.PUBLIC,
                status=AssistantStatus.PUBLISHED,
                version=AssistantVersionCreate(
                    name="Indexed Assistant",
                    system_prompt="You are a helpful assistant.",
                ),
            ),
            owner_user_id=uuid.uuid4(),
        )

        await service.update_assistant(
            assistant.id,
            AssistantUpdate(
                version=AssistantVersionCreate(
                    name="Indexed Assistant v2",
                    system_prompt="You are a newer assistant.",
                )
            ),
        )

    enqueue.assert_called_once_with(str(assistant.id))


@pytest.mark.asyncio
async def test_delete_assistant_enqueues_remove(monkeypatch: pytest.MonkeyPatch) -> None:
    enqueue = Mock()
    monkeypatch.setattr("app.tasks.assistant.remove_assistant_from_qdrant.delay", enqueue)

    async with AsyncSessionLocal() as session:
        service = AssistantService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
        )
        assistant = await service.create_assistant(
            payload=AssistantCreate(
                visibility=AssistantVisibility.PUBLIC,
                status=AssistantStatus.PUBLISHED,
                version=AssistantVersionCreate(
                    name="Indexed Assistant",
                    system_prompt="You are a helpful assistant.",
                ),
            ),
            owner_user_id=uuid.uuid4(),
        )

        await service.delete_assistant(assistant.id)

        deleted = await service.assistant_repo.get(assistant.id)
        assert deleted is None

    enqueue.assert_called_once_with(str(assistant.id))
