import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.assistant import Assistant, AssistantStatus, AssistantVersion, AssistantVisibility
from app.models.review import ReviewStatus, ReviewTask
from app.services.assistant.assistant_retrieval_service import AssistantRetrievalService
from app.services.assistant.assistant_market_service import ASSISTANT_MARKET_ENTITY


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


@pytest.mark.asyncio
async def test_retrieval_skips_when_qdrant_disabled(mocker, async_session):
    service = AssistantRetrievalService(async_session)
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.qdrant_is_configured",
        return_value=False,
    )
    result = await service.search_candidates("query", limit=3)
    assert result == []


@pytest.mark.asyncio
async def test_retrieval_returns_empty_when_limit_zero(mocker, async_session):
    service = AssistantRetrievalService(async_session)
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.qdrant_is_configured",
        return_value=True,
    )
    result = await service.search_candidates("query", limit=0)
    assert result == []


@pytest.mark.asyncio
async def test_retrieval_filters_visibility_and_review(mocker, async_session):
    public_ok_id = uuid.uuid4()
    public_pending_id = uuid.uuid4()
    private_id = uuid.uuid4()

    assistants = [
        Assistant(
            id=public_ok_id,
            visibility=AssistantVisibility.PUBLIC,
            status=AssistantStatus.PUBLISHED,
            owner_user_id=None,
            current_version_id=None,
        ),
        Assistant(
            id=public_pending_id,
            visibility=AssistantVisibility.PUBLIC,
            status=AssistantStatus.PUBLISHED,
            owner_user_id=uuid.uuid4(),
            current_version_id=None,
        ),
        Assistant(
            id=private_id,
            visibility=AssistantVisibility.PRIVATE,
            status=AssistantStatus.PUBLISHED,
            owner_user_id=None,
            current_version_id=None,
        ),
    ]
    for assistant in assistants:
        async_session.add(assistant)

    versions = []
    for assistant in assistants:
        version = AssistantVersion(
            id=uuid.uuid4(),
            assistant_id=assistant.id,
            version="0.1.0",
            name=f"name-{assistant.id}",
            description=None,
            system_prompt="prompt",
            model_config={},
            skill_refs=[],
            tags=[],
        )
        assistant.current_version_id = version.id
        versions.append(version)
        async_session.add(version)

    review_task = ReviewTask(
        id=uuid.uuid4(),
        entity_type=ASSISTANT_MARKET_ENTITY,
        entity_id=public_pending_id,
        status=ReviewStatus.PENDING.value,
    )
    async_session.add(review_task)
    await async_session.commit()

    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.qdrant_is_configured",
        return_value=True,
    )
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.search_points",
        return_value=[
            {"payload": {"assistant_id": str(public_pending_id)}, "score": 0.9},
            {"payload": {"assistant_id": str(private_id)}, "score": 0.8},
            {"payload": {"assistant_id": str(public_ok_id)}, "score": 0.7},
        ],
    )
    mocker.patch("app.services.assistant.assistant_retrieval_service.get_qdrant_client")
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.EmbeddingService.embed_text",
        return_value=[0.1, 0.2],
    )

    service = AssistantRetrievalService(async_session)
    result = await service.search_candidates("query", limit=5)
    assert len(result) == 1
    assert result[0]["assistant_id"] == str(public_ok_id)


@pytest.mark.asyncio
async def test_retrieval_normalizes_limit(mocker, async_session):
    service = AssistantRetrievalService(async_session)
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.qdrant_is_configured",
        return_value=True,
    )
    search_mock = mocker.patch(
        "app.services.assistant.assistant_retrieval_service.search_points",
        return_value=[],
    )
    mocker.patch("app.services.assistant.assistant_retrieval_service.get_qdrant_client")
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.EmbeddingService.embed_text",
        return_value=[0.1, 0.2],
    )

    await service.search_candidates("query", limit="2")
    assert search_mock.call_args.kwargs["limit"] == 6


@pytest.mark.asyncio
async def test_retrieval_includes_approved_owner(mocker, async_session):
    approved_id = uuid.uuid4()
    assistant = Assistant(
        id=approved_id,
        visibility=AssistantVisibility.PUBLIC,
        status=AssistantStatus.PUBLISHED,
        owner_user_id=uuid.uuid4(),
        current_version_id=None,
    )
    version = AssistantVersion(
        id=uuid.uuid4(),
        assistant_id=assistant.id,
        version="0.1.0",
        name="approved",
        description=None,
        system_prompt="prompt",
        model_config={},
        skill_refs=[],
        tags=[],
    )
    assistant.current_version_id = version.id
    review_task = ReviewTask(
        id=uuid.uuid4(),
        entity_type=ASSISTANT_MARKET_ENTITY,
        entity_id=assistant.id,
        status=ReviewStatus.APPROVED.value,
    )
    async_session.add(assistant)
    async_session.add(version)
    async_session.add(review_task)
    await async_session.commit()

    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.qdrant_is_configured",
        return_value=True,
    )
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.search_points",
        return_value=[{"payload": {"assistant_id": str(approved_id)}, "score": 0.9}],
    )
    mocker.patch("app.services.assistant.assistant_retrieval_service.get_qdrant_client")
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.EmbeddingService.embed_text",
        return_value=[0.1, 0.2],
    )

    service = AssistantRetrievalService(async_session)
    result = await service.search_candidates("query", limit=2)
    assert len(result) == 1
    assert result[0]["assistant_id"] == str(approved_id)
