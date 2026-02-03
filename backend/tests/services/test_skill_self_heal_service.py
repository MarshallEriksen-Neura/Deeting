import json

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.schemas.skill_self_heal import SkillSelfHealResult
from app.services.skill_registry.skill_self_heal_service import SkillSelfHealService


def test_self_heal_result_schema():
    payload = {
        "request": {
            "skill_id": "core.tools.docx",
            "manifest_json": {"name": "docx"},
            "logs": ["dry run failed"],
        },
        "response": {
            "status": "success",
            "summary": "added example code",
            "patches": [
                {
                    "path": "usage_spec.example_code",
                    "action": "set",
                    "value": "print('ok')",
                }
            ],
            "updated_manifest": {"name": "docx", "usage_spec": {"example_code": "print('ok')"}},
        },
    }

    result = SkillSelfHealResult(**payload)

    assert result.request.skill_id == "core.tools.docx"
    assert result.request.logs == ["dry run failed"]
    assert result.response.status == "success"
    assert result.response.patches[0].path == "usage_spec.example_code"
    assert result.response.warnings == []


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


class _FakeLLM:
    def __init__(self, payload: dict):
        self.payload = payload

    async def chat_completion(self, *_args, **_kwargs):
        return json.dumps(self.payload)


class _FakeDryRun:
    def __init__(self, status: str = "active"):
        self.status = status

    async def run(self, _skill_id: str, **_kwargs):
        return {"status": self.status}


@pytest.mark.asyncio
async def test_self_heal_updates_manifest_and_retries():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.docx",
                "name": "Docx",
                "manifest_json": {
                    "usage_spec": {"example_code": "print(1)"},
                    "installation": {"dependencies": []},
                },
            }
        )
        llm = _FakeLLM(
            {
                "request": {"skill_id": created.id, "manifest_json": created.manifest_json},
                "response": {
                    "status": "success",
                    "patches": [
                        {
                            "path": "usage_spec.example_code",
                            "action": "set",
                            "value": "print('ok')",
                        },
                        {
                            "path": "installation.dependencies",
                            "action": "set",
                            "value": ["lxml"],
                        },
                    ],
                    "updated_manifest": {
                        "usage_spec": {"example_code": "print('ok')"},
                        "installation": {"dependencies": ["lxml"]},
                    },
                },
            }
        )
        dry_run = _FakeDryRun(status="active")
        service = SkillSelfHealService(repo, llm, dry_run)

        result = await service.self_heal(created.id)
        updated = await repo.get_by_id(created.id)

        assert result.response.status == "success"
        assert updated is not None
        assert updated.manifest_json["usage_spec"]["example_code"] == "print('ok')"
        assert updated.manifest_json["installation"]["dependencies"] == ["lxml"]


@pytest.mark.asyncio
async def test_self_heal_rejects_unsafe_fields():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.pdf",
                "name": "PDF",
                "manifest_json": {"usage_spec": {"example_code": "print(1)"}},
            }
        )
        llm = _FakeLLM(
            {
                "request": {"skill_id": created.id, "manifest_json": created.manifest_json},
                "response": {
                    "status": "success",
                    "patches": [
                        {
                            "path": "execution.timeout_seconds",
                            "action": "set",
                            "value": 999,
                        }
                    ],
                    "updated_manifest": {"execution": {"timeout_seconds": 999}},
                },
            }
        )
        dry_run = _FakeDryRun(status="active")
        service = SkillSelfHealService(repo, llm, dry_run)

        result = await service.self_heal(created.id)

        assert result.response.status == "rejected"
        assert result.response.error == "unsafe_patch"


@pytest.mark.asyncio
async def test_self_heal_rejects_mismatched_error_code():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.image",
                "name": "Image",
                "manifest_json": {
                    "usage_spec": {"example_code": "print(1)"},
                    "metrics": {"last_error": {"code": "artifact_missing"}},
                },
            }
        )
        llm = _FakeLLM(
            {
                "request": {"skill_id": created.id, "manifest_json": created.manifest_json},
                "response": {
                    "status": "success",
                    "patches": [
                        {
                            "path": "installation.dependencies",
                            "action": "set",
                            "value": ["pillow"],
                        }
                    ],
                    "updated_manifest": {
                        "usage_spec": {"example_code": "print(1)"},
                        "installation": {"dependencies": ["pillow"]},
                    },
                },
            }
        )
        dry_run = _FakeDryRun(status="active")
        service = SkillSelfHealService(repo, llm, dry_run)

        result = await service.self_heal(created.id)

        assert result.response.status == "rejected"
        assert result.response.error == "error_code_mismatch"


@pytest.mark.asyncio
async def test_self_heal_records_history():
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        created = await repo.create(
            {
                "id": "core.tools.sheet",
                "name": "Sheet",
                "manifest_json": {
                    "usage_spec": {"example_code": "print(1)"},
                    "installation": {"dependencies": []},
                },
            }
        )
        llm = _FakeLLM(
            {
                "request": {"skill_id": created.id, "manifest_json": created.manifest_json},
                "response": {
                    "status": "success",
                    "patches": [
                        {
                            "path": "usage_spec.example_code",
                            "action": "set",
                            "value": "print('ok')",
                        }
                    ],
                    "updated_manifest": {
                        "usage_spec": {"example_code": "print('ok')"},
                        "installation": {"dependencies": []},
                    },
                },
            }
        )
        dry_run = _FakeDryRun(status="active")
        service = SkillSelfHealService(repo, llm, dry_run)

        await service.self_heal(created.id)
        updated = await repo.get_by_id(created.id)

        assert updated is not None
        history = updated.manifest_json["metrics"]["self_heal_history"]
        assert history
        assert history[0]["status"] == "success"
        assert "usage_spec.example_code" in history[0]["changes"]
