import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.gateway_log import GatewayLog
from app.models.skill_registry import SkillRegistry
from app.models.trace_feedback import TraceFeedback
from app.repositories.bandit_repository import BanditRepository
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.feedback.trace_feedback_service import FeedbackAttributionService

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
async def test_feedback_attribution_updates_skill_and_bandit():
    async with AsyncSessionLocal() as session:
        session.add(
            SkillRegistry(
                id="skill.demo",
                name="Demo",
                status="active",
                manifest_json={},
                env_requirements={},
            )
        )
        session.add(
            GatewayLog(
                trace_id="trace_demo",
                model="gpt-test",
                status_code=200,
                duration_ms=12,
                input_tokens=1,
                output_tokens=1,
                total_tokens=2,
                cost_upstream=0.0,
                cost_user=0.0,
                is_cached=False,
                meta={
                    "tool_calls": [
                        {"name": "skill__skill.demo", "success": True, "error": None}
                    ]
                },
            )
        )
        feedback = TraceFeedback(trace_id="trace_demo", score=-1.0, comment=None)
        session.add(feedback)
        await session.commit()
        await session.refresh(feedback)

        service = FeedbackAttributionService(session)
        await service.process_feedback(str(feedback.id))

        repo = SkillRegistryRepository(session)
        updated = await repo.get_by_id("skill.demo")
        assert updated is not None
        metrics = updated.manifest_json["metrics"]
        assert metrics["feedback_total"] == 1
        assert metrics["feedback_negative"] == 1

        bandit_repo = BanditRepository(session)
        state = await bandit_repo.get_by_item("retrieval:skill", "skill__skill.demo")
        assert state is not None
