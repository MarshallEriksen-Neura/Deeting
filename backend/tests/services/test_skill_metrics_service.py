import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.skill_registry.skill_metrics_service import SkillMetricsService

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
async def test_auto_disable_on_failures():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.docx",
                "name": "Docx",
            }
        )
        service = SkillMetricsService(repo, failure_threshold=2)

        await service.record_failure(created.id)
        await service.record_failure(created.id)

        updated = await repo.get_by_id(created.id)

        assert updated is not None
        assert updated.status == "disabled"
        assert updated.manifest_json["metrics"]["consecutive_failures"] == 2
