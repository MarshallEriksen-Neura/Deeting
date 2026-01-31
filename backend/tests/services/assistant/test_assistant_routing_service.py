import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.assistant import Assistant, AssistantStatus, AssistantVisibility, AssistantVersion
from app.services.assistant.assistant_routing_service import AssistantRoutingService
from app.repositories.assistant_routing_repository import AssistantRoutingRepository


@pytest_asyncio.fixture
async def async_session() -> AsyncSession:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with SessionLocal() as session:
        yield session


async def _create_assistant(session: AsyncSession) -> uuid.UUID:
    assistant_id = uuid.uuid4()
    assistant = Assistant(
        id=assistant_id,
        visibility=AssistantVisibility.PUBLIC,
        status=AssistantStatus.PUBLISHED,
        owner_user_id=None,
        current_version_id=None,
    )
    version = AssistantVersion(
        id=uuid.uuid4(),
        assistant_id=assistant_id,
        version="0.1.0",
        name="Test",
        description=None,
        system_prompt="prompt",
        model_config={},
        skill_refs=[],
        tags=[],
    )
    assistant.current_version_id = version.id
    session.add(assistant)
    session.add(version)
    await session.commit()
    return assistant_id


@pytest.mark.asyncio
async def test_record_trial_updates_state(async_session):
    assistant_id = await _create_assistant(async_session)
    repo = AssistantRoutingRepository(async_session)
    state = await repo.record_trial(assistant_id)
    assert state.total_trials == 1


@pytest.mark.asyncio
async def test_record_feedback_positive(async_session):
    assistant_id = await _create_assistant(async_session)
    service = AssistantRoutingService(async_session)
    await service.record_feedback(assistant_id, "thumbs_up")
    repo = AssistantRoutingRepository(async_session)
    state = await repo.get_by_assistant_id(assistant_id)
    assert state is not None
    assert state.positive_feedback == 1


@pytest.mark.asyncio
async def test_record_feedback_negative(async_session):
    assistant_id = await _create_assistant(async_session)
    service = AssistantRoutingService(async_session)
    await service.record_feedback(assistant_id, "thumbs_down")
    repo = AssistantRoutingRepository(async_session)
    state = await repo.get_by_assistant_id(assistant_id)
    assert state is not None
    assert state.negative_feedback == 1
