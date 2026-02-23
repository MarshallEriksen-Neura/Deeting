import uuid
from unittest.mock import Mock

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.assistant import AssistantStatus, AssistantVisibility
from app.models.review import ReviewStatus, ReviewTask
from app.repositories.assistant_repository import (
    AssistantRepository,
    AssistantVersionRepository,
)
from app.schemas.assistant import (
    AssistantCreate,
    AssistantUpdate,
    AssistantVersionCreate,
    AssistantVersionUpdate,
)
from app.services.assistant.assistant_service import AssistantService
from app.services.assistant.constants import ASSISTANT_MARKET_ENTITY

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
    meili_enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.search_index.upsert_assistant_task.delay", meili_enqueue
    )

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
            owner_user_id=None,
        )

        await service.publish_assistant(assistant.id)

    enqueue.assert_called_once_with(str(assistant.id))
    meili_enqueue.assert_called_once_with(str(assistant.id))


@pytest.mark.asyncio
async def test_publish_user_owned_without_review_skips_qdrant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enqueue = Mock()
    monkeypatch.setattr("app.tasks.assistant.sync_assistant_to_qdrant.delay", enqueue)
    meili_enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.search_index.upsert_assistant_task.delay", meili_enqueue
    )

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
                    name="User Public Assistant",
                    system_prompt="You are a helpful assistant.",
                ),
            ),
            owner_user_id=uuid.uuid4(),
        )

        await service.publish_assistant(assistant.id)

    enqueue.assert_not_called()
    meili_enqueue.assert_called_once_with(str(assistant.id))


@pytest.mark.asyncio
async def test_publish_user_owned_with_approved_review_enqueues_qdrant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enqueue = Mock()
    monkeypatch.setattr("app.tasks.assistant.sync_assistant_to_qdrant.delay", enqueue)
    meili_enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.search_index.upsert_assistant_task.delay", meili_enqueue
    )

    async with AsyncSessionLocal() as session:
        service = AssistantService(
            AssistantRepository(session),
            AssistantVersionRepository(session),
        )
        owner_user_id = uuid.uuid4()
        assistant = await service.create_assistant(
            payload=AssistantCreate(
                visibility=AssistantVisibility.PUBLIC,
                status=AssistantStatus.DRAFT,
                version=AssistantVersionCreate(
                    name="Reviewed User Assistant",
                    system_prompt="You are a helpful assistant.",
                ),
            ),
            owner_user_id=owner_user_id,
        )
        session.add(
            ReviewTask(
                entity_type=ASSISTANT_MARKET_ENTITY,
                entity_id=assistant.id,
                status=ReviewStatus.APPROVED.value,
                submitter_user_id=owner_user_id,
            )
        )
        await session.flush()

        await service.publish_assistant(assistant.id)

    enqueue.assert_called_once_with(str(assistant.id))
    meili_enqueue.assert_called_once_with(str(assistant.id))


@pytest.mark.asyncio
async def test_update_assistant_unpublish_enqueues_remove(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sync_enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.assistant.sync_assistant_to_qdrant.delay", sync_enqueue
    )
    enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.assistant.remove_assistant_from_qdrant.delay", enqueue
    )
    meili_enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.search_index.delete_assistant_task.delay", meili_enqueue
    )
    meili_upsert = Mock()
    monkeypatch.setattr(
        "app.tasks.search_index.upsert_assistant_task.delay", meili_upsert
    )

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
            owner_user_id=None,
        )
        enqueue.reset_mock()
        meili_enqueue.reset_mock()

        await service.update_assistant(
            assistant.id,
            AssistantUpdate(visibility=AssistantVisibility.PRIVATE),
        )

    enqueue.assert_called_once_with(str(assistant.id))
    meili_enqueue.assert_called_once_with(str(assistant.id))


@pytest.mark.asyncio
async def test_update_assistant_version_enqueues_sync(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enqueue = Mock()
    monkeypatch.setattr("app.tasks.assistant.sync_assistant_to_qdrant.delay", enqueue)
    meili_enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.search_index.upsert_assistant_task.delay", meili_enqueue
    )

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
            owner_user_id=None,
        )
        enqueue.reset_mock()
        meili_enqueue.reset_mock()

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
    meili_enqueue.assert_called_once_with(str(assistant.id))


@pytest.mark.asyncio
async def test_delete_assistant_enqueues_remove(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sync_enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.assistant.sync_assistant_to_qdrant.delay", sync_enqueue
    )
    enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.assistant.remove_assistant_from_qdrant.delay", enqueue
    )
    meili_enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.search_index.delete_assistant_task.delay", meili_enqueue
    )
    meili_upsert = Mock()
    monkeypatch.setattr(
        "app.tasks.search_index.upsert_assistant_task.delay", meili_upsert
    )

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
            owner_user_id=None,
        )

        await service.delete_assistant(assistant.id)

        deleted = await service.assistant_repo.get(assistant.id)
        assert deleted is None

    enqueue.assert_called_once_with(str(assistant.id))
    meili_enqueue.assert_called_once_with(str(assistant.id))


@pytest.mark.asyncio
async def test_update_version_enqueues_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    enqueue = Mock()
    monkeypatch.setattr("app.tasks.assistant.sync_assistant_to_qdrant.delay", enqueue)
    meili_enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.search_index.upsert_assistant_task.delay", meili_enqueue
    )

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
            owner_user_id=None,
        )
        enqueue.reset_mock()
        meili_enqueue.reset_mock()

        await service.update_version(
            assistant.id,
            assistant.current_version_id,
            AssistantVersionUpdate(name="Updated Assistant"),
        )

    enqueue.assert_called_once_with(str(assistant.id))
    meili_enqueue.assert_called_once_with(str(assistant.id))
