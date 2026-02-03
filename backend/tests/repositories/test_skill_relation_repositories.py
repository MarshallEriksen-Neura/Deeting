import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.repositories.skill_artifact_repository import SkillArtifactRepository
from app.repositories.skill_capability_repository import SkillCapabilityRepository
from app.repositories.skill_dependency_repository import SkillDependencyRepository

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
async def test_skill_capability_repo_upsert():
    async with AsyncSessionLocal() as session:
        repo = SkillCapabilityRepository(session)
        await repo.replace_all("docx", ["docx", "comments"])
        values = await repo.list_values("docx")
        assert set(values) == {"docx", "comments"}


@pytest.mark.asyncio
async def test_skill_dependency_repo_upsert():
    async with AsyncSessionLocal() as session:
        repo = SkillDependencyRepository(session)
        await repo.replace_all("docx", ["core.text", "core.search"])
        values = await repo.list_values("docx")
        assert set(values) == {"core.text", "core.search"}


@pytest.mark.asyncio
async def test_skill_artifact_repo_upsert():
    async with AsyncSessionLocal() as session:
        repo = SkillArtifactRepository(session)
        await repo.replace_all("docx", ["pdf", "markdown"])
        values = await repo.list_values("docx")
        assert set(values) == {"pdf", "markdown"}
