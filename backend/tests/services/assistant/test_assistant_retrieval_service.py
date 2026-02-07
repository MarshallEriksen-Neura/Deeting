import uuid
from unittest.mock import ANY

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.assistant import (
    Assistant,
    AssistantStatus,
    AssistantVersion,
    AssistantVisibility,
)
from app.models.review import ReviewStatus, ReviewTask
from app.services.assistant.assistant_market_service import ASSISTANT_MARKET_ENTITY
from app.services.assistant.assistant_retrieval_service import (
    MAX_LIMIT,
    OVERSAMPLE_MULTIPLIER,
    AssistantRetrievalService,
)


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
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.DefaultAssistantService.get_default_candidate",
        new=mocker.AsyncMock(return_value=None),
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
async def test_retrieval_falls_back_to_default_assistant(mocker, async_session):
    default_id = uuid.uuid4()
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.qdrant_is_configured",
        return_value=False,
    )
    logger_mock = mocker.patch(
        "app.services.assistant.assistant_retrieval_service.logger"
    )
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.DefaultAssistantService.get_default_candidate",
        new=mocker.AsyncMock(
            return_value={
                "assistant_id": str(default_id),
                "name": "Default",
                "summary": "default summary",
                "score": 0.0,
            }
        ),
    )

    service = AssistantRetrievalService(async_session)
    result = await service.search_candidates("query", limit=3)
    assert result == [
        {
            "assistant_id": str(default_id),
            "name": "Default",
            "summary": "default summary",
            "score": 0.0,
        }
    ]
    logger_mock.info.assert_any_call(
        "assistant_retrieval_fallback_default",
        extra={"reason": "qdrant_disabled"},
    )


@pytest.mark.asyncio
async def test_retrieval_does_not_break_on_filtered_top_hits(mocker, async_session):
    approved_id = uuid.uuid4()
    filtered_id = uuid.uuid4()

    approved = Assistant(
        id=approved_id,
        visibility=AssistantVisibility.PUBLIC,
        status=AssistantStatus.PUBLISHED,
        owner_user_id=None,
        current_version_id=None,
    )
    filtered = Assistant(
        id=filtered_id,
        visibility=AssistantVisibility.PRIVATE,
        status=AssistantStatus.PUBLISHED,
        owner_user_id=None,
        current_version_id=None,
    )
    for assistant in (approved, filtered):
        async_session.add(assistant)

    approved_version = AssistantVersion(
        id=uuid.uuid4(),
        assistant_id=approved_id,
        version="0.1.0",
        name="approved",
        description=None,
        system_prompt="prompt",
        model_config={},
        skill_refs=[],
        tags=[],
    )
    approved.current_version_id = approved_version.id
    async_session.add(approved_version)
    await async_session.commit()

    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.qdrant_is_configured",
        return_value=True,
    )
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.search_points",
        return_value=[
            {"payload": {"assistant_id": str(filtered_id)}, "score": 0.99},
            {"payload": {"assistant_id": str(filtered_id)}, "score": 0.95},
            {"payload": {"assistant_id": str(approved_id)}, "score": 0.90},
        ],
    )
    mocker.patch("app.services.assistant.assistant_retrieval_service.get_qdrant_client")
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.EmbeddingService.embed_text",
        return_value=[0.1, 0.2],
    )
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.AssistantRoutingRepository.get_states_map",
        new=mocker.AsyncMock(return_value={}),
    )

    service = AssistantRetrievalService(async_session)
    result = await service.search_candidates("query", limit=2)
    assert len(result) == 1
    assert result[0]["assistant_id"] == str(approved_id)


@pytest.mark.asyncio
async def test_retrieval_uses_batch_hydrate_query(mocker, async_session):
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
        assistant_id=assistant.id,
        version="0.1.0",
        name="batch",
        description=None,
        system_prompt="prompt",
        model_config={},
        skill_refs=[],
        tags=[],
    )
    assistant.current_version_id = version.id
    async_session.add(assistant)
    async_session.add(version)
    await async_session.commit()

    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.qdrant_is_configured",
        return_value=True,
    )
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.search_points",
        return_value=[{"payload": {"assistant_id": str(assistant_id)}, "score": 0.9}],
    )
    mocker.patch("app.services.assistant.assistant_retrieval_service.get_qdrant_client")
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.EmbeddingService.embed_text",
        return_value=[0.1, 0.2],
    )
    logger_mock = mocker.patch(
        "app.services.assistant.assistant_retrieval_service.logger"
    )

    service = AssistantRetrievalService(async_session)
    mocker.patch.object(
        service, "_fetch_assistants_with_version", side_effect=AssertionError
    )
    mocker.patch.object(service, "_fetch_review_status_map", side_effect=AssertionError)
    mocker.patch.object(
        service.routing_repo, "get_states_map", side_effect=AssertionError
    )

    result = await service.search_candidates("query", limit=1)
    assert len(result) == 1
    assert result[0]["assistant_id"] == str(assistant_id)
    logger_mock.info.assert_any_call(
        "assistant_retrieval_scored",
        extra={
            "hits": 1,
            "unique_candidates": 1,
            "candidates": 1,
            "returned": 1,
            "elapsed_ms": ANY,
        },
    )


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
            owner_user_id=uuid.uuid4(),  # User-owned private assistant should be filtered
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
    assert search_mock.call_args.kwargs["limit"] == 2 * OVERSAMPLE_MULTIPLIER


@pytest.mark.asyncio
async def test_retrieval_caps_limit(mocker, async_session):
    service = AssistantRetrievalService(async_session)
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.qdrant_is_configured",
        return_value=True,
    )
    search_mock = mocker.patch(
        "app.services.assistant.assistant_retrieval_service.search_points",
        return_value=[{"payload": {"assistant_id": str(uuid.uuid4())}, "score": 0.9}]
        * (MAX_LIMIT + 5),
    )
    mocker.patch("app.services.assistant.assistant_retrieval_service.get_qdrant_client")
    mocker.patch(
        "app.services.assistant.assistant_retrieval_service.EmbeddingService.embed_text",
        return_value=[0.1, 0.2],
    )
    mocker.patch.object(
        service,
        "_build_candidates_from_hits",
        new=mocker.AsyncMock(
            return_value=[{"assistant_id": str(uuid.uuid4())}] * MAX_LIMIT
        ),
    )

    result = await service.search_candidates("query", limit=MAX_LIMIT + 10)

    assert search_mock.call_args.kwargs["limit"] == MAX_LIMIT
    assert len(result) == MAX_LIMIT


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
