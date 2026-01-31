import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.services.assistant.assistant_retrieval_service import AssistantRetrievalService


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
