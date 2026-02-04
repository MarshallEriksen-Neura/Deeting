import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models.bandit import BanditArmState
from app.models.base import Base
from app.models.skill_registry import SkillRegistry
from app.repositories.bandit_repository import BanditRepository


class FakeCache:
    def __init__(self) -> None:
        self._store: dict[str, dict] = {}

    async def get_with_version(self, key: str, _version: int | None):
        return self._store.get(key)

    async def set_with_version(
        self, key: str, payload: dict, _version: int, ttl: int | None = None
    ) -> None:
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
    monkeypatch.setattr(
        "app.repositories.bandit_repository.CacheInvalidator", FakeInvalidator
    )

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


@pytest.mark.asyncio
async def test_bandit_repository_skill_report_filters(async_session):
    repo = BanditRepository(async_session)

    skill_active = SkillRegistry(
        id="skill.active",
        name="Active Skill",
        status="active",
        manifest_json={},
        env_requirements={},
    )
    skill_disabled = SkillRegistry(
        id="skill.disabled",
        name="Disabled Skill",
        status="disabled",
        manifest_json={},
        env_requirements={},
    )
    async_session.add_all([skill_active, skill_disabled])

    state_active = BanditArmState(
        scene="retrieval:skill",
        arm_id="skill__skill.active",
        total_trials=10,
        successes=7,
        failures=3,
        reward_metric_type="task_success",
    )
    state_disabled = BanditArmState(
        scene="retrieval:skill",
        arm_id="skill__skill.disabled",
        total_trials=5,
        successes=1,
        failures=4,
        reward_metric_type="task_success",
    )
    state_other = BanditArmState(
        scene="router:llm",
        arm_id="model-x",
        total_trials=2,
        successes=2,
        failures=0,
        reward_metric_type="latency_success",
    )
    async_session.add_all([state_active, state_disabled, state_other])
    await async_session.commit()

    filtered = await repo.get_skill_report(status="active")
    assert len(filtered) == 1
    assert filtered[0]["skill_id"] == "skill.active"

    by_id = await repo.get_skill_report(skill_id="skill.disabled")
    assert len(by_id) == 1
    assert by_id[0]["skill_id"] == "skill.disabled"
