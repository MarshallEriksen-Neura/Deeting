import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.repositories.bandit_repository import BanditRepository


class FakeCache:
    def __init__(self) -> None:
        self._store: dict[str, dict] = {}

    async def get_with_version(self, key: str, _version: int | None):
        return self._store.get(key)

    async def set_with_version(self, key: str, payload: dict, _version: int, ttl: int | None = None) -> None:
        self._store[key] = payload


class FakeInvalidator:
    _version = 0

    async def get_version(self):
        return self._version

    async def bump_version(self):
        self._version += 1
        return self._version


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

    session_local = async_sessionmaker(engine, expire_on_commit=False)
    async with session_local() as session:
        yield session


@pytest.mark.asyncio
async def test_bandit_repository_uses_scene_and_arm_id(async_session, monkeypatch):
    repo = BanditRepository(async_session)
    monkeypatch.setattr("app.repositories.bandit_repository.cache", FakeCache())
    monkeypatch.setattr("app.repositories.bandit_repository.CacheInvalidator", FakeInvalidator)

    state = await repo.ensure_state(
        scene="router:llm",
        arm_id="model-123",
        reward_metric_type="latency_success",
    )
    assert state.scene == "router:llm"
    assert state.arm_id == "model-123"
    assert state.reward_metric_type == "latency_success"

    states = await repo.get_states_map("router:llm", ["model-123"])
    assert "model-123" in states
