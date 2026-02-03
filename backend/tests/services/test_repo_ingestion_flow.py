from types import SimpleNamespace

import pytest

from app.services.skill_registry.parsers.node_parser import NodeRepoParser
from app.services.skill_registry.parsers.python_parser import PythonRepoParser
from app.services.skill_registry.repo_ingestion_service import RepoIngestionService


class FakeRepo:
    def __init__(self) -> None:
        self.items: dict[str, SimpleNamespace] = {}

    async def get_by_id(self, skill_id: str):
        return self.items.get(skill_id)

    async def create(self, payload: dict):
        obj = SimpleNamespace(**payload)
        self.items[payload["id"]] = obj
        return obj

    async def update(self, obj, payload: dict):
        for key, value in payload.items():
            setattr(obj, key, value)
        return obj


class FakeManifestGenerator:
    async def generate(self, *_args, **_kwargs):
        return {
            "name": "Docx Skill",
            "description": "docx parser",
            "capabilities": ["docx"],
            "usage_spec": {"example_code": "print(1)"},
        }


class FakeRelationRepo:
    def __init__(self) -> None:
        self.values: dict[str, list[str]] = {}

    async def replace_all(self, skill_id: str, values: list[str]) -> None:
        self.values[skill_id] = list(values)

    async def list_values(self, skill_id: str) -> list[str]:
        return self.values.get(skill_id, [])


@pytest.mark.asyncio
async def test_repo_ingestion_flow(monkeypatch, tmp_path):
    (tmp_path / "requirements.txt").write_text("lxml", encoding="utf-8")
    (tmp_path / "README.md").write_text("docx", encoding="utf-8")

    monkeypatch.setattr(
        "app.services.skill_registry.repo_ingestion_service.clone_repo",
        lambda *_args, **_kwargs: (tmp_path, tmp_path),
    )

    service = RepoIngestionService(
        repo=FakeRepo(),
        manifest_generator=FakeManifestGenerator(),
        parsers=[PythonRepoParser(), NodeRepoParser()],
    )

    result = await service.ingest_repo(
        "https://example.com/repo.git",
        "main",
        skill_id="docx_skill",
        runtime_hint="python_library",
    )

    assert result["skill_id"] == "docx_skill"


@pytest.mark.asyncio
async def test_repo_ingestion_persists_relations_and_complexity(monkeypatch, tmp_path):
    (tmp_path / "requirements.txt").write_text("lxml", encoding="utf-8")
    (tmp_path / "README.md").write_text("docx", encoding="utf-8")

    monkeypatch.setattr(
        "app.services.skill_registry.repo_ingestion_service.clone_repo",
        lambda *_args, **_kwargs: (tmp_path, tmp_path),
    )

    example_code = "print('docx')"

    class ManifestGeneratorWithRelations:
        async def generate(self, *_args, **_kwargs):
            return {
                "name": "Docx Skill",
                "description": "docx parser",
                "capabilities": ["docx", "comments"],
                "dependencies": ["lxml"],
                "artifacts": ["file"],
                "usage_spec": {"example_code": example_code},
            }

    capability_repo = FakeRelationRepo()
    dependency_repo = FakeRelationRepo()
    artifact_repo = FakeRelationRepo()
    service = RepoIngestionService(
        repo=FakeRepo(),
        manifest_generator=ManifestGeneratorWithRelations(),
        parsers=[PythonRepoParser(), NodeRepoParser()],
        capability_repo=capability_repo,
        dependency_repo=dependency_repo,
        artifact_repo=artifact_repo,
    )

    result = await service.ingest_repo(
        "https://example.com/repo.git",
        "main",
        skill_id="docx_skill",
        runtime_hint="python_library",
    )

    assert result["skill_id"] == "docx_skill"
    assert capability_repo.values["docx_skill"] == ["docx", "comments"]
    assert dependency_repo.values["docx_skill"] == ["lxml"]
    assert artifact_repo.values["docx_skill"] == ["file"]
    created = await service.repo.get_by_id("docx_skill")
    assert created is not None
    assert created.complexity_score == float(len(example_code))


@pytest.mark.asyncio
async def test_repo_ingestion_triggers_qdrant_sync(monkeypatch, tmp_path):
    (tmp_path / "requirements.txt").write_text("lxml", encoding="utf-8")
    (tmp_path / "README.md").write_text("docx", encoding="utf-8")

    monkeypatch.setattr(
        "app.services.skill_registry.repo_ingestion_service.clone_repo",
        lambda *_args, **_kwargs: (tmp_path, tmp_path),
    )

    called: dict[str, str] = {}

    def fake_trigger(skill_id: str) -> None:
        called["skill_id"] = skill_id

    monkeypatch.setattr(
        "app.services.skill_registry.repo_ingestion_service._trigger_qdrant_sync",
        fake_trigger,
    )

    service = RepoIngestionService(
        repo=FakeRepo(),
        manifest_generator=FakeManifestGenerator(),
        parsers=[PythonRepoParser(), NodeRepoParser()],
    )

    result = await service.ingest_repo(
        "https://example.com/repo.git",
        "main",
        skill_id="docx_skill",
        runtime_hint="python_library",
    )

    assert result["skill_id"] == "docx_skill"
    assert called["skill_id"] == "docx_skill"
