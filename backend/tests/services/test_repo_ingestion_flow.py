import json
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services.plugin_ui_bundle_storage import (
    get_bundle_ready_marker,
    get_plugin_ui_bundle_dir,
)
from app.services.skill_registry.parsers.generic_parser import GenericRepoParser
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


@pytest.mark.asyncio
async def test_repo_ingestion_extracts_ui_bundle(monkeypatch, tmp_path):
    workdir = tmp_path / "workdir"
    repo_root = tmp_path / "repo_root"
    temp_root = tmp_path / "temp_root"
    repo_root.mkdir(parents=True, exist_ok=True)
    temp_root.mkdir(parents=True, exist_ok=True)
    (repo_root / "requirements.txt").write_text("lxml", encoding="utf-8")
    (repo_root / "README.md").write_text("plugin", encoding="utf-8")
    (repo_root / "ui").mkdir(parents=True, exist_ok=True)
    (repo_root / "ui" / "index.html").write_text("<html>ok</html>", encoding="utf-8")
    (repo_root / "ui" / "app.js").write_text("console.log('ok')", encoding="utf-8")
    (repo_root / "deeting.json").write_text(
        json.dumps({"entry": {"renderer": "ui/index.html"}}, ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "REPO_INGESTION_WORKDIR", str(workdir))
    monkeypatch.setattr(
        "app.services.skill_registry.repo_ingestion_service.clone_repo",
        lambda *_args, **_kwargs: (repo_root, temp_root),
    )

    service = RepoIngestionService(
        repo=FakeRepo(),
        manifest_generator=FakeManifestGenerator(),
        parsers=[PythonRepoParser(), NodeRepoParser()],
    )
    result = await service.ingest_repo(
        "https://example.com/repo.git",
        "main",
        skill_id="com.example.stock",
        runtime_hint="python_library",
    )

    assert result["skill_id"] == "com.example.stock"
    bundle_dir = get_plugin_ui_bundle_dir("com.example.stock", "main")
    assert (bundle_dir / "index.html").exists()
    assert (bundle_dir / "app.js").exists()
    assert get_bundle_ready_marker(bundle_dir).exists()
    saved = await service.repo.get_by_id("com.example.stock")
    assert saved.manifest_json["ui_bundle"]["renderer_asset_path"] == "index.html"


@pytest.mark.asyncio
async def test_repo_ingestion_skips_ui_bundle_copy_when_ready(monkeypatch, tmp_path):
    workdir = tmp_path / "workdir"
    repo_root = tmp_path / "repo_root"
    temp_root = tmp_path / "temp_root"
    repo_root.mkdir(parents=True, exist_ok=True)
    temp_root.mkdir(parents=True, exist_ok=True)
    (repo_root / "requirements.txt").write_text("lxml", encoding="utf-8")
    (repo_root / "README.md").write_text("plugin", encoding="utf-8")
    (repo_root / "ui").mkdir(parents=True, exist_ok=True)
    (repo_root / "ui" / "index.html").write_text("<html>new</html>", encoding="utf-8")
    (repo_root / "deeting.json").write_text(
        json.dumps({"entry": {"renderer": "ui/index.html"}}, ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "REPO_INGESTION_WORKDIR", str(workdir))
    bundle_dir = get_plugin_ui_bundle_dir("com.example.stock", "main")
    bundle_dir.mkdir(parents=True, exist_ok=True)
    (bundle_dir / "index.html").write_text("<html>old</html>", encoding="utf-8")
    get_bundle_ready_marker(bundle_dir).write_text("ready", encoding="utf-8")
    monkeypatch.setattr(
        "app.services.skill_registry.repo_ingestion_service.clone_repo",
        lambda *_args, **_kwargs: (repo_root, temp_root),
    )

    service = RepoIngestionService(
        repo=FakeRepo(),
        manifest_generator=FakeManifestGenerator(),
        parsers=[PythonRepoParser(), NodeRepoParser()],
    )
    await service.ingest_repo(
        "https://example.com/repo.git",
        "main",
        skill_id="com.example.stock",
        runtime_hint="python_library",
    )

    assert (bundle_dir / "index.html").read_text(encoding="utf-8") == "<html>old</html>"


@pytest.mark.asyncio
async def test_repo_ingestion_with_generic_parser_fallback(monkeypatch, tmp_path):
    (tmp_path / "README.md").write_text("generic repo", encoding="utf-8")

    monkeypatch.setattr(
        "app.services.skill_registry.repo_ingestion_service.clone_repo",
        lambda *_args, **_kwargs: (tmp_path, tmp_path),
    )

    service = RepoIngestionService(
        repo=FakeRepo(),
        manifest_generator=FakeManifestGenerator(),
        parsers=[PythonRepoParser(), NodeRepoParser(), GenericRepoParser()],
    )

    result = await service.ingest_repo(
        "https://example.com/repo.git",
        "main",
        skill_id="generic_skill",
        runtime_hint="python_library",
    )

    assert result["skill_id"] == "generic_skill"
