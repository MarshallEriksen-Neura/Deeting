import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.knowledge import KnowledgeArtifact
from app.repositories.knowledge_repository import KnowledgeRepository

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
async def test_knowledge_repository_uses_knowledge_artifact_model():
    async with AsyncSessionLocal() as session:
        repo = KnowledgeRepository(session)
        assert repo.model is KnowledgeArtifact


@pytest.mark.asyncio
async def test_knowledge_repository_supports_base_crud_for_artifact():
    artifact_url = f"https://docs.example.com/{uuid.uuid4()}"
    async with AsyncSessionLocal() as session:
        repo = KnowledgeRepository(session)
        created = await repo.create(
            {
                "source_url": artifact_url,
                "raw_content": "# Hello",
                "content_hash": "abc123",
                "artifact_type": "documentation",
                "status": "pending",
            }
        )

        fetched = await repo.get(created.id)
        assert fetched is not None
        assert fetched.source_url == artifact_url

        updated = await repo.update(fetched, {"status": "indexed"})
        assert updated.status == "indexed"

        by_url = await repo.get_artifact_by_url(artifact_url)
        assert by_url is not None
        assert by_url.id == created.id
