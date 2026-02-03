import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.skill_registry.dry_run_service import SkillDryRunService
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


class _FakeExecutor:
    def __init__(self, result: dict):
        self.result = result

    async def execute(self, *_args, **_kwargs):
        return self.result


@pytest.mark.asyncio
async def test_dry_run_success_sets_active():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.docx.success",
                "name": "Docx",
                "manifest_json": {
                    "artifacts": [{"name": "output_docx", "type": "file", "path": "out.docx"}],
                },
            }
        )
        executor = _FakeExecutor(
            {
                "stdout": ["ok"],
                "stderr": [],
                "artifacts": [
                    {
                        "name": "output_docx",
                        "type": "file",
                        "path": "/workspace/out.docx",
                        "size": 10,
                        "content_base64": "ZmlsZQ==",
                    }
                ],
            }
        )
        metrics = SkillMetricsService(repo, failure_threshold=2)
        service = SkillDryRunService(repo, executor, metrics, failure_threshold=2)

        result = await service.run(created.id)
        updated = await repo.get_by_id(created.id)

        assert result["status"] == "active"
        assert updated is not None
        assert updated.status == "active"
        assert updated.manifest_json["metrics"]["dry_run_success"] == 1


@pytest.mark.asyncio
async def test_dry_run_missing_artifact_marks_fail():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.docx.fail",
                "name": "Docx",
                "manifest_json": {
                    "artifacts": [{"name": "output_docx", "type": "file", "path": "out.docx"}],
                },
            }
        )
        executor = _FakeExecutor({"stdout": [], "stderr": [], "artifacts": []})
        metrics = SkillMetricsService(repo, failure_threshold=2)
        service = SkillDryRunService(repo, executor, metrics, failure_threshold=2)

        result = await service.run(created.id)
        updated = await repo.get_by_id(created.id)

        assert result["status"] == "dry_run_fail"
        assert result["error_code"] == "artifact_missing"
        assert updated is not None
        assert updated.status == "dry_run_fail"


@pytest.mark.asyncio
async def test_dry_run_threshold_triggers_needs_review():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.docx.review",
                "name": "Docx",
                "manifest_json": {
                    "artifacts": [{"name": "output_docx", "type": "file", "path": "out.docx"}],
                },
            }
        )
        executor = _FakeExecutor({"stdout": [], "stderr": [], "artifacts": []})
        metrics = SkillMetricsService(repo, failure_threshold=2)
        service = SkillDryRunService(repo, executor, metrics, failure_threshold=2)

        await service.run(created.id)
        result = await service.run(created.id)
        updated = await repo.get_by_id(created.id)

        assert result["status"] == "needs_review"
        assert updated is not None
        assert updated.status == "needs_review"
