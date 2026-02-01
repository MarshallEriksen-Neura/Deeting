import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.skill_registry.skill_registry_service import (
    SkillRegistryService,
    STATUS_DRY_RUN_FAIL,
)


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
async def test_dry_run_failure_sets_status():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        service = SkillRegistryService(repo)
        created = await service.create(
            {
                "id": "core.tools.crawler",
                "name": "Crawler",
            }
        )

        await service.mark_dry_run_failed(created.id, error="boom")
        updated = await service.get(created.id)

        assert updated is not None
        assert updated.status == STATUS_DRY_RUN_FAIL
