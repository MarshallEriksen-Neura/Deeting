import asyncio

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base

try:
    from app.models.skill_registry import SkillRegistry
except ImportError as exc:  # pragma: no cover - expected until model exists
    SkillRegistry = None
    _import_error = exc


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


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

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.mark.asyncio
async def test_skill_registry_default_status(async_session: AsyncSession):
    if SkillRegistry is None:  # pragma: no cover - fail until model exists
        pytest.fail(f"SkillRegistry model not implemented: {_import_error}")

    skill = SkillRegistry(id="core.tools.crawler", name="Crawler")
    async_session.add(skill)
    await async_session.commit()
    await async_session.refresh(skill)

    assert skill.status == "draft"
