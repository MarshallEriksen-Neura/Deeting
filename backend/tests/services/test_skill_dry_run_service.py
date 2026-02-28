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


class _FakeSelfHeal:
    def __init__(self, repo: SkillRegistryRepository, status: str = "success"):
        self.repo = repo
        self.status = status
        self.calls: list[str] = []

    async def self_heal(self, skill_id: str):
        self.calls.append(skill_id)
        skill = await self.repo.get_by_id(skill_id)
        if skill:
            manifest = dict(skill.manifest_json or {})
            metrics = dict(manifest.get("metrics") or {})
            history = list(metrics.get("self_heal_history") or [])
            history.append(
                {"status": self.status, "changes": ["usage_spec.example_code"]}
            )
            metrics["self_heal_history"] = history
            manifest["metrics"] = metrics
            await self.repo.update(
                skill, {"status": "active", "manifest_json": manifest}
            )
        return {
            "request": {"skill_id": skill_id, "manifest_json": {}},
            "response": {"status": self.status, "patches": [], "updated_manifest": {}},
        }


@pytest.mark.asyncio
async def test_dry_run_success_sets_active():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.docx.success",
                "name": "Docx",
                "manifest_json": {
                    "artifacts": [
                        {"name": "output_docx", "type": "file", "path": "out.docx"}
                    ],
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
                    "artifacts": [
                        {"name": "output_docx", "type": "file", "path": "out.docx"}
                    ],
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
                    "artifacts": [
                        {"name": "output_docx", "type": "file", "path": "out.docx"}
                    ],
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


@pytest.mark.asyncio
async def test_dry_run_triggers_self_heal_on_failure():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.docx.selfheal",
                "name": "Docx",
                "manifest_json": {
                    "artifacts": [
                        {"name": "output_docx", "type": "file", "path": "out.docx"}
                    ],
                },
            }
        )
        executor = _FakeExecutor({"stdout": [], "stderr": [], "artifacts": []})
        metrics = SkillMetricsService(repo, failure_threshold=2)
        self_heal = _FakeSelfHeal(repo)
        service = SkillDryRunService(
            repo,
            executor,
            metrics,
            failure_threshold=2,
            self_heal_service=self_heal,
            self_heal_max_attempts=2,
        )

        result = await service.run(created.id)
        updated = await repo.get_by_id(created.id)

        assert self_heal.calls == [created.id]
        assert result["status"] == "active"
        assert updated is not None
        assert updated.status == "active"


@pytest.mark.asyncio
async def test_dry_run_skips_self_heal_after_max_attempts():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.docx.selfheal.skip",
                "name": "Docx",
                "manifest_json": {
                    "artifacts": [
                        {"name": "output_docx", "type": "file", "path": "out.docx"}
                    ],
                    "metrics": {
                        "self_heal_history": [
                            {"status": "failed"},
                            {"status": "failed"},
                        ]
                    },
                },
            }
        )
        executor = _FakeExecutor({"stdout": [], "stderr": [], "artifacts": []})
        metrics = SkillMetricsService(repo, failure_threshold=2)
        self_heal = _FakeSelfHeal(repo)
        service = SkillDryRunService(
            repo,
            executor,
            metrics,
            failure_threshold=2,
            self_heal_service=self_heal,
            self_heal_max_attempts=2,
        )

        result = await service.run(created.id)

        assert self_heal.calls == []
        assert result["status"] == "dry_run_fail"


@pytest.mark.asyncio
async def test_dry_run_marks_fail_when_runtime_error_payload_exists():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.docx.runtime.error",
                "name": "Docx",
                "manifest_json": {},
            }
        )
        executor = _FakeExecutor(
            {
                "stdout": [],
                "stderr": [],
                "artifacts": [],
                "error": {
                    "name": "CommandExecError",
                    "value": "fork/exec /usr/bin/bash: no such file or directory",
                    "traceback": [],
                },
            }
        )
        metrics = SkillMetricsService(repo, failure_threshold=2)
        service = SkillDryRunService(repo, executor, metrics, failure_threshold=2)

        result = await service.run(created.id)
        updated = await repo.get_by_id(created.id)

        assert result["status"] == "dry_run_fail"
        assert result["error_code"] == "exec_failed"
        assert updated is not None
        assert updated.status == "dry_run_fail"


@pytest.mark.asyncio
async def test_dry_run_marks_fail_when_stderr_has_python_traceback():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.docx.traceback",
                "name": "Docx",
                "manifest_json": {},
            }
        )
        executor = _FakeExecutor(
            {
                "stdout": [],
                "stderr": [
                    "Traceback (most recent call last):",
                    "ModuleNotFoundError: No module named 'deeting_sdk'",
                ],
                "artifacts": [],
            }
        )
        metrics = SkillMetricsService(repo, failure_threshold=2)
        service = SkillDryRunService(repo, executor, metrics, failure_threshold=2)

        result = await service.run(created.id)
        updated = await repo.get_by_id(created.id)

        assert result["status"] == "dry_run_fail"
        assert result["error_code"] == "exec_failed"
        assert updated is not None
        assert updated.status == "dry_run_fail"
